import type { Page, Route } from "@playwright/test";

/**
 * Stand-ins for the three services the browser talks to:
 *
 *   - the HPO gateway on brainy   (POST /extract-hpo, GET /hpo/es/search)
 *   - GenPhenAI on brainy         (POST /rank-genes)
 *   - the Express API on nodo0    (/api/*)
 *
 * Shapes are copied from diagnostic.ar-api (`services/api-gateway/app/schemas.py`
 * and `services/genphenai/app/main.py`) so a contract drift on either side shows
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

export const PHENOTYPE_FIXTURE = {
    hpo_id: "HP:0002205",
    label: "Recurrent respiratory infections",
    label_es: "Infecciones respiratorias recurrentes",
    span_es: "cuadros respiratorios a repetición",
    span_en: "recurrent respiratory infections",
    start_es: 74,
    end_es: 108,
    start_en: 70,
    end_en: 101,
    negated: false,
    confidence: 0.91,
    matched_by: "es-index",
};

export const NEGATED_PHENOTYPE_FIXTURE = {
    ...PHENOTYPE_FIXTURE,
    hpo_id: "HP:0001250",
    label: "Seizure",
    label_es: "Convulsiones",
    span_es: "sin convulsiones",
    span_en: "no seizures",
    negated: true,
    confidence: 0.88,
};

export const EXTRACT_FIXTURE = {
    symptoms_extracted: ["infecciones respiratorias recurrentes", "bajo peso"],
    model: {
        symptom_extractor: "ollama/qwen2.5",
        translator: "nllb-200",
        phenotyper: "es-index-v1",
    },
    phenotypes: [
        PHENOTYPE_FIXTURE,
        {
            ...PHENOTYPE_FIXTURE,
            hpo_id: "HP:0004322",
            label: "Short stature",
            label_es: "Talla baja",
            span_es: "pesaba menos de lo esperado",
            confidence: 0.76,
        },
        NEGATED_PHENOTYPE_FIXTURE,
    ],
};

export const RANK_FIXTURE = {
    results: [
        {
            gene_id: "CFTR",
            gene_symbol: "CFTR",
            score: 0.412,
            matched_hpo_ids: [],
            matched_count: 0,
            input_count: 2,
            coverage: 0,
            precision: 0,
        },
        {
            gene_id: "DNAH5",
            gene_symbol: "DNAH5",
            score: 0.201,
            matched_hpo_ids: [],
            matched_count: 0,
            input_count: 2,
            coverage: 0,
            precision: 0,
        },
    ],
    specialties: {
        top_specialty: "Pulmonology",
        top_specialties: ["Pulmonology", "Gastroenterology"],
        specialty_ranking: [
            {
                specialty: "Pulmonology",
                matched_genes_count: 2,
                probability_mass: 0.61,
                genes: ["CFTR", "DNAH5"],
                fraction_of_selected_genes: 1,
            },
        ],
        selected_gene_count: 2,
        unmapped_genes: [],
        unmapped_gene_count: 0,
    },
    confidence: 0.78,
};

export const SEARCH_FIXTURE = {
    results: [
        { hpo_id: "HP:0002205", label_es: "Infecciones respiratorias recurrentes", label_en: "Recurrent respiratory infections" },
        { hpo_id: "HP:0002094", label_es: "Disnea", label_en: "Dyspnea" },
    ],
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
