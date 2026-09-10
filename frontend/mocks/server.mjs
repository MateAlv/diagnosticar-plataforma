#!/usr/bin/env node
/**
 * Mock backend for frontend development.
 *
 * Stands in for all three services the browser talks to, on a single port:
 *
 *   /api/auth/*, /api/patients*   the Express API that normally runs on nodo0
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(path.join(HERE, "fixtures.json"), "utf8"));

const PORT = Number(process.env.MOCK_PORT ?? 4500);
const ORIGIN = process.env.MOCK_ALLOWED_ORIGIN ?? "http://localhost:3000";
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS ?? 0);
// Comma-separated list of endpoints to fail, for exercising error states:
//   MOCK_FAIL=extract,rank,save,auth npm run dev:mock
const FAIL = new Set((process.env.MOCK_FAIL ?? "").split(",").map((s) => s.trim()).filter(Boolean));

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// In-memory store, seeded so the app has something to show on first load.
// ---------------------------------------------------------------------------
const users = new Map();   // email -> user
const sessions = new Map(); // access_token -> email
const patients = new Map(); // id -> patient (with diagnoses[])

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

const publicUser = (u) => ({ id: u.id, email: u.email, full_name: u.full_name, role: u.role });

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
      return send(res, 403, { error: "Invalid origin" });
    }
    if (cookies.access_token || cookies.refresh_token) {
      const header = req.headers["x-csrf-token"];
      if (!cookies.csrf_token || !header || cookies.csrf_token !== header) {
        return send(res, 403, { error: "CSRF token mismatch" });
      }
    }
  }

  const log = (note) => console.log(`  ${method} ${pathname} -> ${note}`);

  // --- Express API: auth ---------------------------------------------------
  if (pathname === "/api/auth/me") {
    const user = currentUser(cookies);
    if (!user) { log("401 (no session)"); return send(res, 401, { error: "Unauthorized" }); }
    log(`200 ${user.email}`);
    return send(res, 200, { user: publicUser(user) });
  }

  if (pathname === "/api/auth/refresh" && method === "POST") {
    const user = currentUser(cookies);
    if (!user) { log("401"); return send(res, 401, { error: "No refresh token" }); }
    log("200 refreshed");
    return send(res, 200, { user: publicUser(user) }, issueSession(res, user));
  }

  if ((pathname === "/api/auth/login" || pathname === "/api/auth/signup") && method === "POST") {
    if (FAIL.has("auth")) { log("500 (MOCK_FAIL=auth)"); return send(res, 500, { error: "Internal server error" }); }
    const body = await readBody(req);
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!email.includes("@")) { log("400 bad email"); return send(res, 400, { error: "Invalid payload" }); }
    if (password.length < 8) { log("400 short password"); return send(res, 400, { error: "Invalid payload" }); }

    // Any email works and is created on demand — this is a frontend sandbox,
    // not an auth system. The real backend rejects unknown users with 401.
    const user = users.get(email) ?? makeUser(email, body.fullName ?? body.name ?? "Usuario de Prueba");
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

  // --- Express API: patients ----------------------------------------------
  if (pathname.startsWith("/api/patients")) {
    const segments = pathname.split("/").filter(Boolean); // api, patients, [id], [diagnoses], [diagId]
    const id = segments[2];

    // Checked before authentication, because Express runs router.param callbacks
    // ahead of a route's middleware chain — so the real backend answers 404 here
    // even for an anonymous caller. Getting this order wrong would send someone
    // hunting a phantom auth bug.
    if (id && !UUID_RE.test(id)) { log("404 (non-uuid id)"); return send(res, 404, { error: "Not found" }); }

    const user = currentUser(cookies);
    if (!user) { log("401"); return send(res, 401, { error: "Unauthorized" }); }
    const owned = (p) => p && p.user_id === user.id;

    if (segments.length === 2 && method === "GET") {
      const mine = [...patients.values()].filter(owned).map(toApiPatient);
      log(`200 ${mine.length} patient(s)`);
      return send(res, 200, mine);
    }

    if (segments.length === 2 && method === "POST") {
      if (FAIL.has("save")) { log("500 (MOCK_FAIL=save)"); return send(res, 500, { error: "Failed to save patient" }); }
      const body = await readBody(req);
      const nombre = String(body.nombre ?? "").trim();
      if (!nombre) { log("400 missing nombre"); return send(res, 400, { error: "Invalid request" }); }
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
    if (!owned(patient)) { log("404"); return send(res, 404, { error: "Not found" }); }

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
      if (FAIL.has("save")) { log("500 (MOCK_FAIL=save)"); return send(res, 500, { error: "Failed to save diagnosis" }); }
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
      return send(res, 201, diag);
    }

    if (segments[3] === "diagnoses" && segments.length === 5 && method === "GET") {
      const diag = patient.diagnoses.find((d) => d.id === segments[4]);
      if (!diag) { log("404"); return send(res, 404, { error: "Not found" }); }
      log("200");
      return send(res, 200, diag);
    }
  }

  if (pathname === "/health") return send(res, 200, { status: "ok" });

  // --- brainy: HPO gateway -------------------------------------------------
  if (pathname === "/extract-hpo" && method === "POST") {
    if (FAIL.has("extract")) { log("502 (MOCK_FAIL=extract)"); return send(res, 502, { detail: "extraction-failed" }); }
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
  return send(res, 404, { error: "Not found" });
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
