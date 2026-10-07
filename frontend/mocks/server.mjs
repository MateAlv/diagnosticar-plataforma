#!/usr/bin/env node
/**
 * Mock backend for frontend development.
 *
 * Stands in for all three services the browser talks to, on a single port:
 *
 *   /api/auth/*, /api/patients*,  the Express API that normally runs on nodo0
 *   /api/genes*, /api/questions*
 *   /extract-hpo, /hpo/es/search  the HPO gateway on brainy
 *   /rank-genes                   GenPhenAI on brainy
 *
 * Point every NEXT_PUBLIC_* base URL at this one port; the paths do not collide.
 * `npm run dev:mock` does that for you.
 *
 * It is deliberately faithful rather than permissive: it enforces the same CSRF
 * double-submit and origin checks as the real backend, and returns the same
 * response shapes. A frontend change that would 403 in production 403s here too.
 *
 * State is in memory and resets on restart. Nothing here touches a database,
 * so it is safe to run anywhere — but for the same reason it must never be
 * deployed. See ops/ for the real thing.
 */
import http from "node:http";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createQuestionsEngine } from "./questions-engine.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(path.join(HERE, "fixtures.json"), "utf8"));

const PORT = Number(process.env.MOCK_PORT ?? 4500);
const ORIGIN = process.env.MOCK_ALLOWED_ORIGIN ?? "http://localhost:3000";
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS ?? 0);
// Comma-separated list of endpoints to fail, for exercising error states:
//   MOCK_FAIL=extract,rank,save,auth npm run dev:mock
// The question agent has its own: questions-off (status says disabled),
// questions (503), questions-timeout (504), questions-ratelimit (the hourly
// 429), questions-global-limit (the platform-wide 429), questions-nosymptoms
// (the 400 for a search it cannot ask about). A
// second round while one is running is a 429 without any flag, as in
// production; MOCK_LATENCY_MS makes that easy to reach from two tabs.
const FAIL = new Set((process.env.MOCK_FAIL ?? "").split(",").map((s) => s.trim()).filter(Boolean));

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// In-memory store, seeded so the app has something to show on first load.
// ---------------------------------------------------------------------------
const users = new Map();   // email -> user

// Backoffice staff, in-memory like everything else here. Seeded with a couple
// of entries so the team screen has something to render on a cold start.
const adminStaff = [
  {
    id: crypto.randomUUID(), email: "admin@diagnosticar.ar", fullName: "Equipo Diagnostic.ar",
    organization: "FCEN-UBA", status: "active", mustChangePassword: false,
    createdAt: new Date(Date.now() - 86400000 * 210).toISOString(),
    lastLoginAt: new Date(Date.now() - 3600000 * 5).toISOString(),
  },
  {
    id: crypto.randomUUID(), email: "coordinacion.admin@iquibicen.ar", fullName: "Coordinación clínica",
    organization: "IQUIBICEN/CONICET", status: "active", mustChangePassword: true,
    createdAt: new Date(Date.now() - 86400000 * 4).toISOString(), lastLoginAt: null,
  },
];
const sessions = new Map(); // access_token -> email
const patients = new Map(); // id -> patient (with diagnoses[])
// Three rounds, so the screens between rounds can be seen locally too.
const questions = createQuestionsEngine(fixtures.questions, {
  noUsableSymptoms: FAIL.has("questions-nosymptoms"),
  sequence: [fixtures.questions.round1, fixtures.questions.followUp, fixtures.questions.round2],
});

/** Whether `diagnosisId` belongs to one of `user`'s patients. */
function ownsDiagnosis(user, diagnosisId) {
  for (const patient of patients.values()) {
    if (patient.user_id !== user.id) continue;
    if (patient.diagnoses.some((d) => d.id === diagnosisId)) return true;
  }
  return false;
}

// The wording of the health-data consent, as backend/src/services/consent.ts.
const HEALTH_DATA_CONSENT_VERSION = "2026-10-06";

function makeUser(email, fullName = "Usuario de Prueba") {
  const user = {
    id: crypto.randomUUID(),
    email,
    // Matches the real backend's response exactly — it returns `full_name`,
    // not `name`. Do not "improve" this: the frontend's AuthUser type expects
    // `name`, and papering over that here would hide the mismatch in dev.
    full_name: fullName,
    role: "user",
  };
  users.set(email, user);
  return user;
}

const DEMO_EMAIL = "demo@diagnosticar.test";
const demoUser = makeUser(DEMO_EMAIL, "Familia Demo");
demoUser.health_data_consent_version = HEALTH_DATA_CONSENT_VERSION;

function validBirthDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  const now = new Date();
  return date.getTime() <= now.getTime() && year >= now.getUTCFullYear() - 120;
}

function seedPatient(nombre, { fechaNacimiento, sexo, localidad }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  patients.set(id, {
    id,
    user_id: demoUser.id,
    nombre,
    fecha_nacimiento: fechaNacimiento,
    sexo,
    localidad,
    pais: "Argentina",
    created_at: now,
    updated_at: now,
    diagnoses: [
      {
        id: crypto.randomUUID(),
        patient_id: id,
        historia_clinica:
          "Cuadros respiratorios a repetición desde los 2 años, con sibilancias. " +
          "Pesaba menos de lo esperado para su edad.",
        symptoms_extracted: [
          { description: "Infecciones respiratorias recurrentes", code: "HP:0002205" },
          { description: "Talla baja", code: "HP:0004322" },
        ],
        phenotypes: fixtures.extract.phenotypes,
        genphen_genes: fixtures.rank.results,
        genphen_specialties: fixtures.rank.specialties,
        genphen_confidence: fixtures.rank.confidence,
        created_at: now,
      },
    ],
  });
}
seedPatient("Sofía", { fechaNacimiento: "2018-04-03", sexo: "femenino", localidad: "CABA" });
seedPatient("Mateo", { fechaNacimiento: "2015-11-20", sexo: "masculino", localidad: "La Plata" });

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function send(res, status, body, extraHeaders = {}) {
  const payload = body === null ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({ __invalidJson: true }); }
    });
  });
}

/** Mirrors the real cookie triplet, including the readable CSRF token. */
function issueSession(res, user) {
  const accessToken = crypto.randomBytes(24).toString("hex");
  const csrfToken = crypto.randomBytes(16).toString("hex");
  sessions.set(accessToken, user.email);
  return {
    "Set-Cookie": [
      `access_token=${accessToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900`,
      `refresh_token=${crypto.randomBytes(24).toString("hex")}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
      // Not HttpOnly — the browser must read it to echo it back as a header.
      `csrf_token=${csrfToken}; Path=/; SameSite=Lax; Max-Age=604800`,
    ],
  };
}

function clearSession(cookies) {
  if (cookies.access_token) sessions.delete(cookies.access_token);
  return {
    "Set-Cookie": [
      "access_token=; Path=/; HttpOnly; Max-Age=0",
      "refresh_token=; Path=/; HttpOnly; Max-Age=0",
      "csrf_token=; Path=/; Max-Age=0",
    ],
  };
}

function currentUser(cookies) {
  const email = sessions.get(cookies.access_token ?? "");
  return email ? users.get(email) : null;
}

const hasConsent = (u) => u.health_data_consent_version === HEALTH_DATA_CONSENT_VERSION;
const publicUser = (u) => ({ id: u.id, email: u.email, full_name: u.full_name, role: u.role, health_data_consent: hasConsent(u) });

function toApiPatient(p) {
  const latest = p.diagnoses.at(-1) ?? null;
  return {
    id: p.id,
    user_id: p.user_id,
    user_email_snapshot: null,
    nombre: p.nombre,
    fecha_nacimiento: p.fecha_nacimiento,
    sexo: p.sexo,
    localidad: p.localidad,
    pais: p.pais,
    created_at: p.created_at,
    updated_at: p.updated_at,
    latest_diagnosis: latest && {
      id: latest.id,
      historia_clinica: latest.historia_clinica,
      symptoms_extracted: latest.symptoms_extracted,
      genphen_confidence: latest.genphen_confidence,
      genphen_specialties: latest.genphen_specialties,
      genphen_genes_top5: (latest.genphen_genes ?? []).slice(0, 5),
      created_at: latest.created_at,
    },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = url;
  const method = req.method ?? "GET";
  const cookies = parseCookies(req);

  if (method === "OPTIONS") {
    return send(res, 204, null, {
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,X-CSRF-Token",
      "Access-Control-Max-Age": "600",
    });
  }

  if (LATENCY_MS) await sleep(LATENCY_MS);

  // Same origin + CSRF rules as backend/src/middleware/csrfMiddleware.ts, so a
  // missing header fails here exactly as it would in production.
  if (!SAFE_METHODS.has(method) && pathname.startsWith("/api/")) {
    const origin = req.headers.origin;
    if (origin && origin !== ORIGIN) {
      return send(res, 403, { error: "Invalid origin", code: "invalid_origin" });
    }
    if ((cookies.access_token || cookies.refresh_token) && pathname !== "/api/auth/logout") {
      const header = req.headers["x-csrf-token"];
      if (!cookies.csrf_token || !header || cookies.csrf_token !== header) {
        return send(res, 403, { error: "CSRF token mismatch", code: "csrf_mismatch" });
      }
    }
  }

  const log = (note) => console.log(`  ${method} ${pathname} -> ${note}`);

  // --- Express API: auth ---------------------------------------------------
  if (pathname === "/api/auth/me") {
    const user = currentUser(cookies);
    if (!user) { log("401 (no session)"); return send(res, 401, { error: "Unauthorized", code: "unauthenticated" }); }
    log(`200 ${user.email}`);
    return send(res, 200, { user: publicUser(user) });
  }

  if (pathname === "/api/auth/refresh" && method === "POST") {
    const user = currentUser(cookies);
    if (!user) { log("401"); return send(res, 401, { error: "No refresh token", code: "no_refresh_token" }); }
    log("200 refreshed");
    return send(res, 200, { user: publicUser(user) }, issueSession(res, user));
  }

  if ((pathname === "/api/auth/login" || pathname === "/api/auth/signup") && method === "POST") {
    if (FAIL.has("auth")) { log("500 (MOCK_FAIL=auth)"); return send(res, 500, { error: "Internal server error", code: "internal" }); }
    const body = await readBody(req);
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!email.includes("@")) { log("400 bad email"); return send(res, 400, { error: "Invalid payload", code: "invalid_payload", field: "email" }); }
    if (password.length < 8) { log("400 short password"); return send(res, 400, { error: "Invalid payload", code: "invalid_payload", field: "password" }); }

    // Any email works and is created on demand — this is a frontend sandbox,
    // not an auth system. The real backend rejects unknown users with 401.
    const user = users.get(email) ?? makeUser(email, body.fullName ?? body.name ?? "Usuario de Prueba");
    if (pathname === "/api/auth/signup" && body.healthDataConsent === true) user.health_data_consent_version = HEALTH_DATA_CONSENT_VERSION;
    log(`200 signed in as ${email}`);
    return send(res, 200, { user: publicUser(user) }, issueSession(res, user));
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    log("200 logged out");
    return send(res, 200, { message: "Logged out" }, clearSession(cookies));
  }

  if (pathname === "/api/auth/verify" && method === "POST") {
    log("200 verified");
    return send(res, 200, { message: "Verified" });
  }

  // --- Express API: the HPO tree ------------------------------------------
  // Authenticated like the real route. Served from a real slice of the tree
  // (fixtures.hpoTree), three levels under the terms the fixtures use.
  if (pathname === "/api/hpo/terms" && method === "GET") {
    const user = currentUser(cookies);
    if (!user) { log("401 (no session)"); return send(res, 401, { error: "Unauthorized", code: "unauthenticated" }); }
    const ids = (url.searchParams.get("ids") ?? "").split(",").map((id) => id.trim().toUpperCase())
      .filter((id) => /^HP:\d{7}$/.test(id));
    if (ids.length === 0 || ids.length > 100) return send(res, 400, { error: "ids must be 1 to 100 HPO ids", code: "invalid_request" });
    const tree = fixtures.hpoTree ?? { terms: {}, children: {} };
    const terminos = [...new Set(ids)].flatMap((id) => {
      const t = tree.terms[id];
      return t ? [{ hpo_id: id, nombre: t.nombre, genes: t.genes, tiene_hijos: Boolean(tree.children[id]?.length), hijos: t.hijos, debajo: t.debajo }] : [];
    });
    return send(res, 200, { terminos });
  }
  {
    const m = pathname.match(/^\/api\/hpo\/terms\/([^/]+)\/children$/);
    if (m && method === "GET") {
      const user = currentUser(cookies);
      if (!user) { log("401 (no session)"); return send(res, 401, { error: "Unauthorized", code: "unauthenticated" }); }
      const id = decodeURIComponent(m[1]).toUpperCase();
      if (!/^HP:\d{7}$/.test(id)) return send(res, 400, { error: "id must be an HPO id", code: "invalid_request" });
      const tree = fixtures.hpoTree ?? { terms: {}, children: {} };
      const t = tree.terms[id];
      if (!t) return send(res, 404, { error: "unknown HPO term", code: "not_found" });
      const summary = (hid) => ({ hpo_id: hid, nombre: tree.terms[hid].nombre, genes: tree.terms[hid].genes, tiene_hijos: Boolean(tree.children[hid]?.length), hijos: tree.terms[hid].hijos, debajo: tree.terms[hid].debajo });
      return send(res, 200, { termino: summary(id), hijos: (tree.children[id] ?? []).map(summary) });
    }
  }

  // --- Express API: gene profiles ------------------------------------------
  // Authenticated like the real route: the request carries the phenotypes the
  // patient reported, and an open endpoint would let anyone enumerate the
  // database. The technical block only ships when the caller asks for it.
  if (pathname === "/api/genes/batch" && method === "POST") {
    const user = currentUser(cookies);
    if (!user) { log("401 (no session)"); return send(res, 401, { error: "Unauthorized", code: "unauthenticated" }); }

    const body = await readBody(req);
    {
      const symbols = Array.isArray(body?.symbols) ? body.symbols : [];
      const reported = new Set((body?.reported ?? []).map((id) => String(id).toUpperCase()));
      const profiles = {};

      for (const raw of symbols.slice(0, 60)) {
        const profile = fixtures.genes?.[String(raw).toUpperCase()];
        if (!profile) continue;
        const all = [...profile.coincidencias, ...profile.frecuentes_no_reportados];
        const matched = all.filter((s) => reported.has(s.hpo_id.toUpperCase()));
        const { tecnico, ...rest } = profile;
        const entry = {
          ...rest,
          coincidencias: matched,
          frecuentes_no_reportados: all.filter((s) => !reported.has(s.hpo_id.toUpperCase())).slice(0, 5),
          reportados_cubiertos: [...new Set(matched.map((s) => s.hpo_id.toUpperCase()))],
          coincidencias_por_reporte: matched.map((s) => ({
            reportado_hpo_id: s.hpo_id.toUpperCase(), exacta: s, especificas: [],
          })),
        };
        if (body?.view === "professional") entry.tecnico = tecnico;
        profiles[profile.simbolo] = entry;
      }

      log(`200 gene batch (${Object.keys(profiles).length}/${symbols.length})`);
      return send(res, 200, { profiles, disponible: true });
    }
  }

  if (pathname.startsWith("/api/genes/")) {
    const user = currentUser(cookies);
    if (!user) { log("401 (no session)"); return send(res, 401, { error: "Unauthorized", code: "unauthenticated" }); }

    const symbol = decodeURIComponent(pathname.slice("/api/genes/".length)).toUpperCase();
    const profile = fixtures.genes?.[symbol];
    if (!profile) {
      log(`404 (no profile for ${symbol})`);
      return send(res, 404, { error: "Gen sin descripción disponible", code: "profile_unavailable", disponible: true });
    }

    const reported = new Set(
      (url.searchParams.get("reported") ?? "")
        .split(",")
        .map((id) => id.trim().toUpperCase())
        .filter(Boolean),
    );

    // Re-split the fixture's symptoms against what this caller reported, so the
    // mock reflects the request rather than replaying a fixed answer.
    const allSymptoms = [...profile.coincidencias, ...profile.frecuentes_no_reportados];
    const coincidencias = allSymptoms.filter((s) => reported.has(s.hpo_id.toUpperCase()));
    const noReportados = allSymptoms.filter((s) => !reported.has(s.hpo_id.toUpperCase()));

    const { tecnico, ...rest } = profile;
    const body = {
      ...rest,
      coincidencias,
      frecuentes_no_reportados: noReportados.slice(0, 5),
      reportados_cubiertos: [...new Set(coincidencias.map((s) => s.hpo_id.toUpperCase()))],
      coincidencias_por_reporte: coincidencias.map((s) => ({
        reportado_hpo_id: s.hpo_id.toUpperCase(), exacta: s, especificas: [],
      })),
    };
    if (url.searchParams.get("view") === "professional") body.tecnico = tecnico;

    log(`200 gene ${symbol}`);
    return send(res, 200, body);
  }

  // --- Express API: question agent ----------------------------------------
  // Authenticated and owner-scoped like every route that touches a diagnosis:
  // another account's diagnosis id is a 404, never a 403.
  if (pathname === "/api/questions/status" && method === "GET") {
    const user = currentUser(cookies);
    if (!user) { log("401 (no session)"); return send(res, 401, { error: "Unauthorized", code: "unauthenticated" }); }
    const enabled = !FAIL.has("questions-off") && fixtures.questions.status.enabled;
    log(`200 enabled=${enabled}`);
    return send(res, 200, { enabled });
  }

  if (pathname === "/api/questions/rounds" && method === "POST") {
    const user = currentUser(cookies);
    if (!user) { log("401 (no session)"); return send(res, 401, { error: "Unauthorized", code: "unauthenticated" }); }
    const refuse = (code, headers) => {
      const { status, body } = questions.failure(code);
      return send(res, status, body, headers);
    };
    if (FAIL.has("questions-off")) { log("503 (MOCK_FAIL=questions-off)"); return refuse("disabled"); }
    if (FAIL.has("questions")) { log("503 (MOCK_FAIL=questions)"); return refuse("unavailable"); }
    if (FAIL.has("questions-timeout")) { log("504 (MOCK_FAIL=questions-timeout)"); return refuse("timeout"); }
    // Exposed because the dev mock is cross-origin; production is same-origin.
    const retryHeaders = (seconds) => ({ "Retry-After": seconds, "Access-Control-Expose-Headers": "Retry-After" });
    if (FAIL.has("questions-ratelimit")) {
      log("429 (MOCK_FAIL=questions-ratelimit)");
      return refuse("rate_limited", retryHeaders("1800"));
    }
    if (FAIL.has("questions-global-limit")) {
      log("429 (MOCK_FAIL=questions-global-limit)");
      const capped = questions.globalLimitError;
      return send(res, capped.status, capped.body, retryHeaders(capped.retryAfter));
    }
    const body = await readBody(req);
    if (typeof body?.diagnosisId === "string" && !(UUID_RE.test(body.diagnosisId) && ownsDiagnosis(user, body.diagnosisId))) {
      log("404 (diagnosis not found for this user)");
      return refuse("not_found");
    }
    const release = questions.tryAcquire(user.id);
    if (!release) {
      log("429 (a round is already running for this account)");
      const busy = questions.inFlightError;
      return send(res, busy.status, busy.body, retryHeaders(busy.retryAfter));
    }
    try {
      // The global latency above already ran; this holds the lock for as long
      // as the agent would, so a second tab can meet it.
      if (LATENCY_MS) await sleep(LATENCY_MS);
      const result = questions.round(body);
      log(`${result.status} round ${result.body?.round ?? "-"} ${result.body?.status ?? result.body?.code ?? ""}`);
      return send(res, result.status, result.body);
    } finally {
      release();
    }
  }

  if (pathname.startsWith("/api/questions/") && method === "GET") {
    const diagnosisId = decodeURIComponent(pathname.slice("/api/questions/".length));
    const notFound = questions.failure("not_found");
    if (!UUID_RE.test(diagnosisId)) { log("404 (non-uuid id)"); return send(res, notFound.status, notFound.body); }
    const user = currentUser(cookies);
    if (!user) { log("401 (no session)"); return send(res, 401, { error: "Unauthorized", code: "unauthenticated" }); }
    if (!ownsDiagnosis(user, diagnosisId)) { log("404"); return send(res, notFound.status, notFound.body); }
    const result = questions.session(diagnosisId);
    log(`200 session ${result.session ? "found" : "none"}`);
    return send(res, 200, result);
  }

  // --- Express API: admin (backoffice) -------------------------------------
  // Faithful to the real thing in the way that matters: a caller without the
  // admin role gets 404, not 403, so the panel is invisible rather than merely
  // forbidden. Sign in as an address containing "admin" to get the role.
  if (pathname.startsWith("/api/admin")) {
    const user = currentUser(cookies);
    if (!user) { log("401 (no session)"); return send(res, 401, { error: "Unauthorized", code: "unauthenticated" }); }
    if (!user.email.includes("admin")) {
      log("404 (not an admin)");
      return send(res, 404, { error: "Not found", code: "not_found" });
    }

    const days = Math.min(Math.max(parseInt(new URL(req.url, "http://x").searchParams.get("days") ?? "30", 10) || 30, 1), 365);
    const series = (n, base, spread) =>
      Array.from({ length: n }, (_, i) => {
        const d = new Date(Date.now() - (n - 1 - i) * 86400000);
        // Deterministic pseudo-noise with a weekly dip, so the charts look like
        // real traffic instead of a straight line.
        const weekday = d.getUTCDay();
        const weekend = weekday === 0 || weekday === 6 ? 0.45 : 1;
        const wobble = (Math.sin(i * 1.7) + Math.sin(i * 0.6)) * spread;
        return { day: d.toISOString().slice(0, 10), count: Math.max(0, Math.round((base + wobble) * weekend)) };
      });

    if (pathname === "/api/admin/overview") {
      log("200 overview");
      return send(res, 200, {
        totals: {
          users: 1284, usersLast30d: 96, activeLast30d: 412,
          patients: 1731, diagnoses: 2140, diagnosesLast30d: 288, diagnosesLast24h: 11,
        },
        diagnosesPerDay: series(days, 9, 4),
        signupsPerDay: series(days, 3, 2),
        authProviders: [ { label: "local", count: 921 }, { label: "google", count: 363 } ],
        days,
      });
    }

    if (pathname === "/api/admin/insights") {
      log("200 insights");
      return send(res, 200, {
        specialties: [
          { label: "Neurología", count: 412 }, { label: "Genética médica", count: 388 },
          { label: "Endocrinología", count: 241 }, { label: "Neumonología", count: 187 },
          { label: "Cardiología", count: 156 }, { label: "Oftalmología", count: 132 },
          { label: "Nefrología", count: 98 }, { label: "Dermatología", count: 74 },
        ],
        phenotypes: [
          { label: "Retraso del desarrollo", count: 531 }, { label: "Hipotonía", count: 402 },
          { label: "Convulsiones", count: 377 }, { label: "Talla baja", count: 298 },
          { label: "Dismorfia facial", count: 254 }, { label: "Microcefalia", count: 201 },
          { label: "Ataxia", count: 164 }, { label: "Pérdida auditiva", count: 121 },
        ],
        confidence: [
          { label: "0.0–0.1", count: 18 }, { label: "0.1–0.2", count: 34 },
          { label: "0.2–0.3", count: 61 }, { label: "0.3–0.4", count: 118 },
          { label: "0.4–0.5", count: 196 }, { label: "0.5–0.6", count: 287 },
          { label: "0.6–0.7", count: 341 }, { label: "0.7–0.8", count: 262 },
          { label: "0.8–0.9", count: 148 }, { label: "0.9–1.0", count: 57 },
        ],
        countries: [
          { label: "Argentina", count: 1489 }, { label: "Uruguay", count: 87 },
          { label: "Chile", count: 64 }, { label: "Paraguay", count: 41 },
          { label: "Sin especificar", count: 29 },
        ],
      });
    }

    if (pathname === "/api/admin/release") {
      log("200 release");
      return send(res, 200, {
        version: "dev", commit: "mock0000000000000000000000000000000000000",
        builtAt: "unknown", environment: "development",
        startedAt: new Date(Date.now() - 4200_000).toISOString(),
        uptimeSeconds: 4200, node: process.version,
      });
    }

    if (pathname === "/api/admin/staff" && method === "GET") {
      log("200 staff");
      return send(res, 200, { staff: adminStaff });
    }

    if (pathname === "/api/admin/staff" && method === "POST") {
      const body = await readBody(req);
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        log("400 bad email");
        return send(res, 400, { error: "A valid email is required", code: "invalid_email" });
      }
      if (adminStaff.some((m) => m.email === email)) {
        log("409 duplicate");
        return send(res, 409, { error: "An account with that email already exists", code: "email_taken" });
      }
      const member = {
        id: crypto.randomUUID(), email, fullName: body.fullName ?? null,
        organization: null, status: "active", mustChangePassword: true,
        createdAt: new Date().toISOString(), lastLoginAt: null,
      };
      adminStaff.push(member);
      log(`201 invited ${email}`);
      return send(res, 201, {
        user: { id: member.id, email: member.email, fullName: member.fullName },
        temporaryPassword: Array.from({ length: 20 }, () =>
          "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"[Math.floor(Math.random() * 56)]).join(""),
      });
    }

    const revoke = pathname.match(/^\/api\/admin\/staff\/([^/]+)\/revoke$/);
    if (revoke && method === "POST") {
      const idx = adminStaff.findIndex((m) => m.id === revoke[1]);
      if (idx === -1) { log("404 unknown member"); return send(res, 404, { error: "Not found", code: "not_found" }); }
      if (adminStaff.length <= 1) { log("400 last admin"); return send(res, 400, { error: "Refusing to remove the last admin", code: "last_admin" }); }
      adminStaff.splice(idx, 1);
      log("200 revoked");
      return send(res, 200, { ok: true });
    }

    log("404");
    return send(res, 404, { error: "Not found", code: "not_found" });
  }

  // --- Express API: patients ----------------------------------------------
  if (pathname.startsWith("/api/patients")) {
    const segments = pathname.split("/").filter(Boolean); // api, patients, [id], [diagnoses], [diagId]
    const id = segments[2];

    // Checked before authentication, because Express runs router.param callbacks
    // ahead of a route's middleware chain — so the real backend answers 404 here
    // even for an anonymous caller. Getting this order wrong would send someone
    // hunting a phantom auth bug.
    if (id && !UUID_RE.test(id)) { log("404 (non-uuid id)"); return send(res, 404, { error: "Not found", code: "not_found" }); }

    const user = currentUser(cookies);
    if (!user) { log("401"); return send(res, 401, { error: "Unauthorized", code: "unauthenticated" }); }
    const owned = (p) => p && p.user_id === user.id;

    if (segments.length === 2 && method === "GET") {
      const mine = [...patients.values()].filter(owned).map(toApiPatient);
      log(`200 ${mine.length} patient(s)`);
      return send(res, 200, mine);
    }

    if (segments.length === 2 && method === "POST") {
      if (FAIL.has("save")) { log("500 (MOCK_FAIL=save)"); return send(res, 500, { error: "Internal server error", code: "internal" }); }
      const body = await readBody(req);
      if (body.nombre != null && typeof body.nombre !== "string") { log("400 bad nombre"); return send(res, 400, { error: "Invalid request", code: "invalid_request" }); }
      // Same limits as the backend: a real, past birth date and at most 10,000 characters of history.
      if (body.fechaNacimiento != null && body.fechaNacimiento !== "" && !validBirthDate(body.fechaNacimiento)) { log("400 bad fechaNacimiento"); return send(res, 400, { error: "Invalid request", code: "invalid_request" }); }
      if (typeof body.historiaClinica === "string" && body.historiaClinica.trim().length > 10_000) { log("400 historia too long"); return send(res, 400, { error: "Invalid request", code: "invalid_request" }); }
      // Same rule as the backend: no name → «Paciente N», one past the highest N in the account.
      let nombre = (body.nombre ?? "").trim();
      if (!nombre) {
        const taken = [...patients.values()]
          .filter((p) => p.user_id === user.id)
          .map((p) => /^Paciente ([0-9]{1,9})$/.exec(p.nombre)?.[1])
          .filter(Boolean)
          .map(Number);
        nombre = `Paciente ${Math.max(0, ...taken) + 1}`;
      }
      const now = new Date().toISOString();
      const pid = crypto.randomUUID();
      const diagId = crypto.randomUUID();
      patients.set(pid, {
        id: pid, user_id: user.id, nombre,
        fecha_nacimiento: body.fechaNacimiento ?? null,
        sexo: body.sexo ?? null, localidad: body.localidad ?? null, pais: body.pais ?? null,
        created_at: now, updated_at: now,
        diagnoses: [{
          id: diagId, patient_id: pid,
          historia_clinica: body.historiaClinica ?? "",
          symptoms_extracted: body.symptomsExtracted ?? [],
          phenotypes: body.phenotypes ?? [],
          genphen_genes: body.genphenGenes ?? [],
          genphen_specialties: body.genphenSpecialties ?? null,
          genphen_confidence: body.genphenConfidence ?? null,
          created_at: now,
        }],
      });
      log(`201 created "${nombre}"`);
      return send(res, 201, { patient: patients.get(pid), diagnosisId: diagId });
    }

    const patient = patients.get(id);
    if (!owned(patient)) { log("404"); return send(res, 404, { error: "Not found", code: "not_found" }); }

    if (segments.length === 3 && method === "GET") { log("200"); return send(res, 200, toApiPatient(patient)); }

    if (segments.length === 3 && method === "DELETE") {
      patients.delete(id);
      log("204 deleted");
      return send(res, 204, null);
    }

    if (segments[3] === "diagnoses" && segments.length === 4 && method === "GET") {
      log(`200 ${patient.diagnoses.length} diagnosis/es`);
      return send(res, 200, patient.diagnoses);
    }

    if (segments[3] === "diagnoses" && segments.length === 4 && method === "POST") {
      if (FAIL.has("save")) { log("500 (MOCK_FAIL=save)"); return send(res, 500, { error: "Internal server error", code: "internal" }); }
      const body = await readBody(req);
      const diag = {
        id: crypto.randomUUID(), patient_id: id,
        historia_clinica: body.historiaClinica ?? "",
        symptoms_extracted: body.symptomsExtracted ?? [],
        phenotypes: body.phenotypes ?? [],
        genphen_genes: body.genphenGenes ?? [],
        genphen_specialties: body.genphenSpecialties ?? null,
        genphen_confidence: body.genphenConfidence ?? null,
        created_at: new Date().toISOString(),
      };
      patient.diagnoses.push(diag);
      log("201 diagnosis appended");
      return send(res, 201, { diagnosisId: diag.id });
    }

    if (segments[3] === "diagnoses" && segments.length === 5 && method === "GET") {
      const diag = patient.diagnoses.find((d) => d.id === segments[4]);
      if (!diag) { log("404"); return send(res, 404, { error: "Not found", code: "not_found" }); }
      log("200");
      return send(res, 200, diag);
    }
  }

  if (pathname === "/health") return send(res, 200, { status: "ok" });

  // --- brainy: HPO gateway -------------------------------------------------
  if (pathname === "/extract-hpo" && method === "POST") {
    if (FAIL.has("extract")) { log("502 (MOCK_FAIL=extract)"); return send(res, 502, { detail: "extraction-failed" }); }
    // The gateway can reject a request before extracting: 401 when REQUIRE_AUTH
    // is on and no access_token cookie arrives, 429 over the per-IP budget, 503
    // when too many extractions are already in flight. Each has its own message
    // in the wizard, so each is reachable here.
    if (FAIL.has("extract-auth")) { log("401 (MOCK_FAIL=extract-auth)"); return send(res, 401, { detail: "Unauthorized" }); }
    if (FAIL.has("extract-ratelimit")) { log("429 (MOCK_FAIL=extract-ratelimit)"); return send(res, 429, { detail: "Rate limit exceeded" }); }
    // The per-account and whole-service limits, shaped as the gateway sends them.
    if (FAIL.has("extract-user-limit")) { log("429 (MOCK_FAIL=extract-user-limit)"); return send(res, 429, { detail: { error: "user-rate-limit", retry_after: 1200, message: "Alcanzaste el límite de análisis de texto por ahora." } }); }
    if (FAIL.has("extract-budget")) { log("429 (MOCK_FAIL=extract-budget)"); return send(res, 429, { detail: { error: "global-budget", retry_after: 10800, message: "El análisis de texto libre llegó a su límite por ahora." } }); }
    if (FAIL.has("extract-busy")) { log("503 (MOCK_FAIL=extract-busy)"); return send(res, 503, { detail: "Service is busy, try again shortly" }); }
    const body = await readBody(req);
    const text = String(body.text_es ?? "");
    // The real gateway caps text_es at 10000 chars with a 422.
    if (!text) { log("422 empty text"); return send(res, 422, { detail: "text_es must not be empty" }); }
    if (text.length > 10000) { log("422 too long"); return send(res, 422, { detail: "text_es too long" }); }
    log(`200 ${fixtures.extract.phenotypes.length} phenotype(s)`);
    return send(res, 200, fixtures.extract);
  }

  if (pathname === "/hpo/es/search" && method === "GET") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const results = fixtures.search.results
      .filter((r) => !q || r.label_es.toLowerCase().includes(q) || r.hpo_id.toLowerCase().includes(q))
      .slice(0, limit);
    log(`200 ${results.length} match(es) for "${q}"`);
    return send(res, 200, { results });
  }

  // --- brainy: GenPhenAI ---------------------------------------------------
  if (pathname === "/rank-genes" && method === "POST") {
    if (FAIL.has("rank")) { log("503 (MOCK_FAIL=rank)"); return send(res, 503, { detail: "genphenia-inference-unreachable" }); }
    const body = await readBody(req);
    const hpoIds = Array.isArray(body.hpo_ids) ? body.hpo_ids : [];
    if (hpoIds.length === 0) { log("422 no hpo_ids"); return send(res, 422, { detail: "hpo_ids must not be empty" }); }
    const topK = Number(body.top_k ?? 50);
    log(`200 ranked for ${hpoIds.length} HPO term(s), top_k=${topK}`);
    return send(res, 200, {
      ...fixtures.rank,
      results: fixtures.rank.results.slice(0, topK).map((r) => ({ ...r, input_count: hpoIds.length })),
    });
  }

  if (pathname === "/healthz") return send(res, 200, { status: "ok", mode: "mock" });

  log("404 (unhandled)");
  return send(res, 404, { error: "Not found", code: "not_found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Mock API listening on http://localhost:${PORT}`);
  console.log(`  Allowing browser origin ${ORIGIN}`);
  console.log(`  Sign in with ANY email + any password of 8+ chars (try ${DEMO_EMAIL} / demo1234)`);
  console.log(`  Seeded ${patients.size} patients for that demo account`);
  if (LATENCY_MS) console.log(`  Injecting ${LATENCY_MS}ms latency`);
  if (FAIL.size) console.log(`  Forcing failures: ${[...FAIL].join(", ")}`);
  console.log();
});
