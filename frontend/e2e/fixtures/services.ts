import type { Page, Route } from "@playwright/test";
import fixtures from "../../mocks/fixtures.json";

/**
 * Stand-ins for the three services the browser talks to:
 *
 *   - the HPO gateway on brainy   (POST /extract-hpo, GET /hpo/es/search)
 *   - GenPhenAI on brainy         (POST /rank-genes)
 *   - the Express API on nodo0    (/api/*)
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
    { user = null as null | { id: string; email: string; full_name?: string | null; role?: string }, patients = [] as unknown[] } = {},
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
            return json(route, 201, { patient: { id: "11111111-1111-4111-8111-111111111111" }, diagnosisId: "22222222-2222-4222-8222-222222222222" });
        }
        return json(route, 200, patients);
    });
    await page.route("**/api/patients/**", (route) => json(route, 201, { id: "33333333-3333-4333-8333-333333333333" }));
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
        const entry: Record<string, unknown> = {
            ...rest,
            coincidencias: all.filter((s) => reported.has(s.hpo_id.toUpperCase())),
            frecuentes_no_reportados: all.filter((s) => !reported.has(s.hpo_id.toUpperCase())).slice(0, 5),
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
                    notice: "Share this password out of band.",
                });
            }
            return json(route, 200, { staff });
        }
        return json(route, 404, { error: "Not found" });
    });
}
