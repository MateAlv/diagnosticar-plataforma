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
