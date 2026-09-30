import type { Page, Route } from "@playwright/test";
import fixtures from "../../mocks/fixtures.json";
import { createQuestionsEngine } from "../../mocks/questions-engine.mjs";
import type { QuestionErrorCode } from "../../src/lib/questions-api";

/**
 * Stand-ins for the three services the browser talks to:
 *
 *   - the HPO gateway on brainy   (POST /extract-hpo, GET /hpo/es/search)
 *   - GenPhenAI on brainy         (POST /rank-genes)
 *   - the Express API on nodo0    (/api/*, the question agent included)
 *
 * Response bodies come from mocks/fixtures.json, which mirrors diagnostic.ar-api
 * (`services/api-gateway/app/schemas.py`, `services/genphenai/app/main.py`) and is
 * shared with the `npm run dev:mock` server. A contract drift on either side shows
 * up as a failing test here rather than a blank screen in production. CI has no
 * route to brainy and no GPU, so these are the only way the wizard is testable.
 */

export type ServiceOverrides = {
    extractStatus?: number;
    extractBody?: unknown;
    rankStatus?: number;
    rankBody?: unknown;
    /** Delay in ms before answering, for loading-state assertions. */
    latencyMs?: number;
};

// Fixture data lives in mocks/fixtures.json so the dev mock server and this
// suite cannot drift apart. Change a service response there, once.
export const PHENOTYPE_FIXTURE = fixtures.extract.phenotypes[0];
export const NEGATED_PHENOTYPE_FIXTURE = fixtures.extract.phenotypes.find((p) => p.negated)!;
export const EXTRACT_FIXTURE = fixtures.extract;
export const RANK_FIXTURE = fixtures.rank;
export const SEARCH_FIXTURE = fixtures.search;
export const QUESTIONS_FIXTURE = fixtures.questions;

/** The diagnosis id every stubbed save answers with. */
export const SAVED_DIAGNOSIS_ID = "22222222-2222-4222-8222-222222222222";

export type QuestionsMockOptions = {
    /** What GET /api/questions/status says. */
    enabled?: boolean;
    /** Answer every round POST with the backend's `{ error, code }` body for this code. */
    failCode?: QuestionErrorCode;
    /** Answer every round POST with this status and a body without a code, as a proxy in front of the backend would. */
    failStatus?: number;
    /** Sent with a `failCode` or `failStatus` failure. */
    retryAfter?: string;
    /** Delay in ms before a round answers, holding the account's round lock meanwhile. */
    latencyMs?: number;
    /** A session already on the server for the saved diagnosis, for resume. */
    seed?: { finished: boolean; rounds: object[]; latest: object };
    /** Break the contract and send the medical fields in patient mode. */
    leakMedicalFields?: boolean;
    /** Every new session is the 400 for a search with no usable symptoms. */
    noUsableSymptoms?: boolean;
    /** Apply the first round of this kind on the server and then drop its reply, as a lost connection would. */
    dropReplyTo?: "start" | "answers" | "finish";
    /** Answer this many round POSTs with 401 before serving them, as an expired access token would. */
    expireTokens?: number;
    /** Serve a second round that still asks (`followUp`) before the closing one. */
    threeRounds?: boolean;
    /** Rounds carry the agent's "sin IA" warning, as when the language model is out of quota. */
    simpleMode?: boolean;
};

const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Intercepts the two brainy services. Call before navigating. */
export async function mockModelServices(page: Page, overrides: ServiceOverrides = {}) {
    const {
        extractStatus = 200,
        extractBody = EXTRACT_FIXTURE,
        rankStatus = 200,
        rankBody = RANK_FIXTURE,
        latencyMs = 0,
    } = overrides;

    const wait = () => (latencyMs ? new Promise((r) => setTimeout(r, latencyMs)) : Promise.resolve());

    await page.route("**/extract-hpo", async (route) => {
        await wait();
        await json(route, extractStatus, extractBody);
    });
    await page.route("**/hpo/es/search**", (route) => json(route, 200, SEARCH_FIXTURE));
    await page.route("**/rank-genes", async (route) => {
        await wait();
        await json(route, rankStatus, rankBody);
    });
}

/**
 * Intercepts the Express API. `user` null keeps the browser anonymous, which is
 * what the demo path expects.
 */
export async function mockBackend(
    page: Page,
    {
        user = null as null | { id: string; email: string; full_name?: string | null; role?: string },
        patients = [] as unknown[],
        questions = {} as QuestionsMockOptions,
    } = {},
) {
    await page.route("**/api/auth/me", (route) =>
        user ? json(route, 200, { user }) : json(route, 401, { error: "Unauthorized" }),
    );
    await page.route("**/api/auth/refresh", (route) =>
        user ? json(route, 200, { user }) : json(route, 401, { error: "No refresh token" }),
    );
    await page.route("**/api/auth/logout", (route) => json(route, 200, { message: "Logged out" }));
    await page.route("**/api/patients", (route) => {
        if (route.request().method() === "POST") {
            return json(route, 201, { patient: { id: "11111111-1111-4111-8111-111111111111" }, diagnosisId: SAVED_DIAGNOSIS_ID });
        }
        return json(route, 200, patients);
    });
    // The real append answers { diagnosisId }, like the create does.
    await page.route("**/api/patients/**", (route) =>
        route.request().method() === "POST"
            ? json(route, 201, { diagnosisId: "33333333-3333-4333-8333-333333333333" })
            : json(route, 201, { id: "33333333-3333-4333-8333-333333333333" }),
    );
    return { questions: await mockQuestions(page, questions) };
}

/**
 * Stands in for /api/questions with the same session rules as the dev mock
 * (mocks/questions-engine.mjs): every pending question must be answered, a
 * finished session is a 409, a resend of applied answers is replayed, one
 * round runs at a time, and patient mode gets no medical fields.
 *
 * Returns the engine, so a test can change the session behind the page's
 * back, as another tab would.
 */
async function mockQuestions(page: Page, options: QuestionsMockOptions) {
    const {
        enabled = true,
        failCode,
        failStatus,
        retryAfter,
        latencyMs = 0,
        seed,
        leakMedicalFields = false,
        noUsableSymptoms = false,
        threeRounds = false,
    } = options;
    let dropReplyTo = options.dropReplyTo;
    const kindOf = (body: { answers?: unknown[]; finish?: boolean }) =>
        body.finish ? "finish" : body.answers?.length ? "answers" : "start";
    let expireTokens = options.expireTokens ?? 0;
    const { round1, followUp, round2 } = fixtures.questions;
    const engine = createQuestionsEngine(fixtures.questions, {
        withholdMedical: !leakMedicalFields,
        noUsableSymptoms,
        simpleMode: options.simpleMode ?? false,
        sequence: threeRounds ? [round1, followUp, round2] : [round1, round2],
    });
    if (seed) engine.seed(SAVED_DIAGNOSIS_ID, seed);
    const wait = () => (latencyMs ? new Promise((r) => setTimeout(r, latencyMs)) : Promise.resolve());
    // Cross-origin here, same-origin in production, where the header is
    // readable without being exposed.
    const retryHeaders = (seconds?: string): Record<string, string> =>
        seconds ? { "Retry-After": seconds, "Access-Control-Expose-Headers": "Retry-After" } : {};

    await page.route("**/api/questions/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());

        if (url.pathname.endsWith("/questions/status")) return json(route, 200, { enabled });

        if (url.pathname.endsWith("/questions/rounds") && request.method() === "POST") {
            if (expireTokens > 0) {
                expireTokens -= 1;
                return json(route, 401, { error: "Unauthorized" });
            }
            if (failCode) {
                await wait();
                const { status, body } = engine.failure(failCode);
                return route.fulfill({
                    status,
                    contentType: "application/json",
                    headers: retryHeaders(retryAfter),
                    body: JSON.stringify(body),
                });
            }
            if (failStatus) {
                await wait();
                return route.fulfill({
                    status: failStatus,
                    contentType: "text/html",
                    headers: retryHeaders(retryAfter),
                    body: `<html><body><h1>${failStatus}</h1></body></html>`,
                });
            }
            const release = engine.tryAcquire(SAVED_DIAGNOSIS_ID);
            if (!release) {
                const busy = engine.inFlightError;
                return route.fulfill({
                    status: busy.status,
                    contentType: "application/json",
                    headers: retryHeaders(busy.retryAfter),
                    body: JSON.stringify(busy.body),
                });
            }
            try {
                await wait();
                const body = JSON.parse(request.postData() ?? "{}");
                const result = engine.round(body);
                if (dropReplyTo && result.status === 200 && kindOf(body) === dropReplyTo) {
                    dropReplyTo = undefined;
                    return route.abort("connectionreset");
                }
                return json(route, result.status, result.body);
            } finally {
                release();
            }
        }

        if (request.method() === "GET") {
            const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
            return json(route, 200, engine.session(id));
        }
        return json(route, 404, { error: "Not found" });
    });
    return engine;
}

/** The gene profile fixtures, keyed by symbol, as /api/genes would return them. */
export const GENE_FIXTURES = fixtures.genes as unknown as Record<string, GeneProfileFixture>;

type SymptomFixture = {
    hpo_id: string;
    nombre: string;
    frecuencia_pct: number | null;
    frecuencia_texto: string | null;
};

type GeneProfileFixture = {
    simbolo: string;
    coincidencias: SymptomFixture[];
    frecuentes_no_reportados: SymptomFixture[];
    tecnico?: Record<string, unknown>;
    [key: string]: unknown;
};

/**
 * Stands in for GET /api/genes/:symbol.
 *
 * Faithful in the two ways that matter: it re-splits the symptoms against the
 * phenotypes the caller actually reported, and it withholds the technical block
 * unless the professional view was requested. A lenient mock here would let the
 * audience split rot without any test noticing.
 */
export async function mockGeneProfiles(page: Page, { available = true } = {}) {
    const split = (profile: GeneProfileFixture, reportedIds: string[], view?: string) => {
        const reported = new Set(reportedIds.map((id) => id.toUpperCase()));
        const all = [...profile.coincidencias, ...profile.frecuentes_no_reportados];
        const { tecnico, ...rest } = profile;
        const coincidencias = all.filter((s) => reported.has(s.hpo_id.toUpperCase()));
        // Mirrors the backend's grouping: one entry per reported term, so a
        // single thing the reader said cannot read as several matches.
        type Grouped = { reportado_hpo_id: string; exacta: SymptomFixture | null; especificas: SymptomFixture[] };
        const porReporte: Grouped[] = [];
        for (const symptom of coincidencias) {
            const id = symptom.hpo_id.toUpperCase();
            let entry: Grouped | undefined = porReporte.find((e) => e.reportado_hpo_id === id);
            if (!entry) {
                entry = { reportado_hpo_id: id, exacta: null, especificas: [] };
                porReporte.push(entry);
            }
            entry.exacta = symptom;
        }
        const entry: Record<string, unknown> = {
            ...rest,
            coincidencias,
            frecuentes_no_reportados: all.filter((s) => !reported.has(s.hpo_id.toUpperCase())).slice(0, 5),
            // Which reported phenotypes the gene engages — the meter's numerator,
            // and not the same as coincidencias.length. The real backend also
            // counts matches reached through the HPO graph; this mock has no
            // ontology, so here the two happen to coincide.
            reportados_cubiertos: [
                ...new Set(coincidencias.map((s) => s.hpo_id.toUpperCase())),
            ],
            coincidencias_por_reporte: porReporte,
        };
        if (view === "professional") entry.tecnico = tecnico;
        return entry;
    };

    // Single-gene route, kept for callers that still use it.
    await page.route("**/api/genes/*", (route) => {
        const url = new URL(route.request().url());
        const symbol = decodeURIComponent(url.pathname.split("/").pop() ?? "").toUpperCase();
        const profile = available ? GENE_FIXTURES[symbol] : undefined;
        if (!profile) {
            return json(route, 404, { error: "Gen sin descripción disponible", disponible: available });
        }
        const reported = (url.searchParams.get("reported") ?? "").split(",").map((i) => i.trim()).filter(Boolean);
        return json(route, 200, split(profile, reported, url.searchParams.get("view") ?? undefined));
    });

    // The results screen fetches the whole ranking in one request. Registered
    // after the catch-all on purpose: Playwright gives precedence to the most
    // recently added route, so this is what /batch actually hits.
    await page.route("**/api/genes/batch", (route) => {
        const body = JSON.parse(route.request().postData() ?? "{}") as {
            symbols?: string[]; reported?: string[]; view?: string;
        };
        const profiles: Record<string, unknown> = {};
        for (const symbol of body.symbols ?? []) {
            const profile = available ? GENE_FIXTURES[symbol.toUpperCase()] : undefined;
            if (profile) profiles[profile.simbolo] = split(profile, body.reported ?? [], body.view);
        }
        return json(route, 200, { profiles, disponible: available });
    });
}

type HpoTreeFixture = {
    terms: Record<string, { nombre: string; genes: number; tiene_hijos: boolean }>;
    children: Record<string, string[]>;
};
export const HPO_TREE_FIXTURE = (fixtures as unknown as { hpoTree: HpoTreeFixture }).hpoTree;

/**
 * The HPO tree behind the "too general" warning, from the real slice in
 * fixtures.hpoTree. Opt-in, like the gene profiles: without it the lookups
 * fail and the wizard shows no warning, which is what every other spec expects.
 */
export async function mockHpoTree(page: Page, { failChildren = false } = {}) {
    const tree = HPO_TREE_FIXTURE;
    const summary = (id: string) => ({
        hpo_id: id,
        nombre: tree.terms[id].nombre,
        genes: tree.terms[id].genes,
        tiene_hijos: Boolean(tree.children[id]?.length),
    });
    await page.route("**/api/hpo/terms?**", (route) => {
        const ids = (new URL(route.request().url()).searchParams.get("ids") ?? "")
            .split(",").map((id) => id.trim().toUpperCase()).filter((id) => tree.terms[id]);
        return json(route, 200, { terminos: [...new Set(ids)].map(summary) });
    });
    await page.route("**/api/hpo/terms/*/children", (route) => {
        if (failChildren) return json(route, 500, { error: "Internal server error" });
        const parts = new URL(route.request().url()).pathname.split("/");
        const id = decodeURIComponent(parts[parts.length - 2]).toUpperCase();
        if (!tree.terms[id]) return json(route, 404, { error: "unknown HPO term" });
        return json(route, 200, { termino: summary(id), hijos: (tree.children[id] ?? []).map(summary) });
    });
}

/**
 * Waits until every <img> inside `selector` has actually decoded. next/image
 * lazy-loads, and an undecoded image still occupies its intrinsic width — which
 * silently breaks any layout assertion measured too early.
 */
export async function waitForImagesDecoded(page: Page, selector: string, timeout = 20_000) {
    await page.waitForFunction(
        (sel) => {
            const root = document.querySelector(sel);
            if (!root) return false;
            const imgs = [...root.querySelectorAll("img")];
            return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
        },
        selector,
        { timeout },
    );
}

/** Collects console errors and page exceptions for a "renders clean" assertion. */
export function collectPageErrors(page: Page) {
    const errors: string[] = [];
    page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        // The API is mocked per-test; unrouted calls surface as network noise
        // rather than real rendering faults.
        if (/Failed to load resource|net::ERR_/.test(text)) return;
        errors.push(text);
    });
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    return errors;
}

/**
 * Intercepts /api/admin. `isAdmin: false` answers 404 rather than 403, which is
 * what the real backend does — the backoffice is invisible to accounts without
 * the role, not merely forbidden. Keeping the mock faithful here matters: a
 * permissive mock would let a UI regression that mishandles 404 pass CI.
 */
export async function mockAdminApi(
    page: Page,
    { isAdmin = true, mustChangePassword = false, staff = [] as unknown[] } = {},
) {
    const deny = (route: Route) =>
        mustChangePassword
            ? json(route, 403, { error: "Password change required", code: "PASSWORD_CHANGE_REQUIRED" })
            : json(route, 404, { error: "Not found" });

    const days = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
            day: new Date(Date.now() - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
            count: 5 + (i % 7),
        }));

    await page.route("**/api/admin/**", async (route) => {
        if (!isAdmin || mustChangePassword) return deny(route);
        const url = new URL(route.request().url());

        if (url.pathname.endsWith("/admin/overview")) {
            return json(route, 200, {
                totals: {
                    users: 1284, usersLast30d: 96, activeLast30d: 412,
                    patients: 1731, diagnoses: 2140, diagnosesLast30d: 288, diagnosesLast24h: 11,
                },
                diagnosesPerDay: days(30),
                signupsPerDay: days(30),
                authProviders: [{ label: "local", count: 921 }, { label: "google", count: 363 }],
                days: 30,
            });
        }
        if (url.pathname.endsWith("/admin/insights")) {
            return json(route, 200, {
                specialties: [{ label: "Neurología", count: 412 }, { label: "Genética médica", count: 388 }],
                phenotypes: [{ label: "Hipotonía", count: 402 }],
                confidence: Array.from({ length: 10 }, (_, i) => ({
                    label: `${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}`,
                    count: 20 + i * 10,
                })),
                countries: [{ label: "Argentina", count: 1489 }],
            });
        }
        if (url.pathname.endsWith("/admin/release")) {
            return json(route, 200, {
                version: "v0.1.0", commit: "abc123def4567890", builtAt: "2026-09-17T12:00:00Z",
                environment: "production", startedAt: new Date(Date.now() - 3_600_000).toISOString(),
                uptimeSeconds: 3600, node: "v22.0.0",
            });
        }
        if (url.pathname.endsWith("/admin/staff")) {
            if (route.request().method() === "POST") {
                return json(route, 201, {
                    user: { id: "44444444-4444-4444-8444-444444444444", email: "nuevo@example.ar", fullName: null },
                    temporaryPassword: "AbCdEfGhJkLmNpQrStUv",
                });
            }
            return json(route, 200, { staff });
        }
        return json(route, 404, { error: "Not found" });
    });
}
