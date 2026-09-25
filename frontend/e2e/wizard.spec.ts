import { test, expect } from "@playwright/test";
import {
    mockModelServices,
    mockBackend,
    collectPageErrors,
    EXTRACT_FIXTURE,
    RANK_FIXTURE,
} from "./fixtures/services";

/**
 * The wizard is the product. This drives it end to end against stand-ins for
 * the brainy services, so a broken run is caught in CI instead of by a family
 * typing a real clinical history.
 */

const HISTORIA =
    "Nena de 7 años. Desde los 2 años tiene tos productiva casi todos los días, " +
    "con sibilancias y cuadros respiratorios a repetición. Se cansa más que otros " +
    "chicos al correr. En el último control pesaba menos de lo esperado para su edad.";

const TEST_USER = {
    id: "44444444-4444-4444-8444-444444444444",
    email: "familia@example.test",
    full_name: "Familia de Prueba",
    role: "user",
};

/** Demo mode starts at step 2 and needs no account. */
async function openDemoWizard(page: import("@playwright/test").Page) {
    await page.goto("/nuevo?demo=1", { waitUntil: "networkidle" });
}

/**
 * Signed-in wizard, which starts at step 1. Demo mode blurs the gene ranking and
 * hides the specialty orientation behind "Iniciá sesión", so the full result
 * screen is only reachable as an authenticated user.
 */
async function openAuthedWizard(page: import("@playwright/test").Page) {
    await mockBackend(page, { user: TEST_USER });
    await page.goto("/nuevo", { waitUntil: "networkidle" });

    // Step 1 gates on all five demographic fields being filled.
    await page.getByPlaceholder(/Ej\. Marcelo, Mamá/).fill("Paciente E2E");
    await page.locator('input[type="date"]').fill("2018-04-03");
    await page.getByPlaceholder("Ciudad o localidad").fill("CABA");
    await page.locator("select").filter({ hasText: "Argentina" }).selectOption("Argentina");
    await page.locator("select").filter({ hasText: "Femenino" }).selectOption("femenino");

    await page.getByRole("button", { name: /^Continuar$/ }).click();
}

test.beforeEach(async ({ page }) => {
    await mockBackend(page);
    await mockModelServices(page);
});

test("extracting symptoms from clinical text populates the HPO list", async ({ page }) => {
    await openDemoWizard(page);

    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();

    // Positive findings appear with their Spanish HPO labels.
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible();
    await expect(page.getByText("Talla baja")).toBeVisible();
});

test("a negated finding is not added as a present symptom", async ({ page }) => {
    // "sin convulsiones" must never become a symptom the model then ranks on.
    await openDemoWizard(page);

    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible();

    const negated = EXTRACT_FIXTURE.phenotypes.find((p) => p.negated)!;
    const list = page.locator("main");
    await expect(
        list.getByText(negated.label_es, { exact: true }),
        "a negated phenotype was added as a present symptom",
    ).toHaveCount(0);
});

test("re-analysing unchanged text is blocked, avoiding a redundant model call", async ({ page }) => {
    // brainy runs the LLM; re-sending identical text would burn GPU time for
    // nothing, so the button stays disabled until the text actually changes.
    await openDemoWizard(page);

    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible();

    await expect(page.getByRole("button", { name: /Analizar de nuevo/ })).toBeDisabled();
});

test("re-analysing after an edit does not duplicate already-found symptoms", async ({ page }) => {
    await openDemoWizard(page);

    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible();

    // Edit the text so re-analysis unlocks; the mock returns the same phenotypes.
    await page.getByPlaceholder(/Nena de 7 años/).fill(`${HISTORIA} Sin fiebre.`);
    await page.getByRole("button", { name: /Analizar de nuevo/ }).click();

    await expect(page.getByText(/ya estaban en la lista/i)).toBeVisible();
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toHaveCount(1);
});

test("a full run reaches a diagnostic orientation with the disclaimer", async ({ page }) => {
    const errors = collectPageErrors(page);
    await openAuthedWizard(page);

    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible();

    await page.getByRole("button", { name: /Revisar y continuar/ }).click();
    await page.getByRole("button", { name: /Buscar genes candidatos/ }).click();

    // Specialties come back translated to Spanish, not echoed in English.
    // "pulmonology" -> "Neumonología" per src/lib/especialidades.ts.
    // Appears twice: the recommendation chip and the per-area list.
    await expect(page.getByText("Neumonología").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/qué especialista consultar/i)).toBeVisible();

    // Regulatory: the orientation must never be presented as a diagnosis.
    await expect(
        page.getByText(/no constituye un diagnóstico médico/i),
        "the results screen is missing its disclaimer",
    ).toBeVisible();

    expect(errors).toEqual([]);
});

test("no English specialty name leaks into the results screen", async ({ page }) => {
    // GenPhenAI answers in English. Both the recommendation chips and the
    // ranking table must go through traducirEspecialidad — the table was
    // showing raw "Pulmonology" to Spanish-speaking families.
    await openAuthedWizard(page);
    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible();
    await page.getByRole("button", { name: /Revisar y continuar/ }).click();
    await page.getByRole("button", { name: /Buscar genes candidatos/ }).click();

    await expect(page.getByText("Neumonología").first()).toBeVisible({ timeout: 20_000 });

    const body = await page.locator("main").innerText();
    for (const english of ["Pulmonology", "Gastroenterology", "Developmental disorders"]) {
        expect(body, `untranslated specialty "${english}" is on screen`).not.toContain(english);
    }
});

test("gene results are rendered from the GenPhenAI response", async ({ page }) => {
    await openDemoWizard(page);
    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible();
    await page.getByRole("button", { name: /Revisar y continuar/ }).click();
    await page.getByRole("button", { name: /Buscar genes candidatos/ }).click();

    await expect(page.getByText(RANK_FIXTURE.results[0].gene_symbol).first()).toBeVisible({
        timeout: 20_000,
    });
});

test("an HPO gateway outage shows a message instead of a blank screen", async ({ page }) => {
    // brainy is reached over a reverse SSH tunnel; it going away is routine.
    await mockModelServices(page, { extractStatus: 502, extractBody: { detail: "extraction-failed" } });
    await openDemoWizard(page);

    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();

    await expect(page.getByText(/extraction-failed|No pudimos analizar el texto/i)).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
});

test("a GenPhenAI outage surfaces an error and keeps the entered symptoms", async ({ page }) => {
    await mockModelServices(page, { rankStatus: 503, rankBody: { detail: "genphenia-inference-unreachable" } });
    await openDemoWizard(page);

    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible();
    await page.getByRole("button", { name: /Revisar y continuar/ }).click();
    await page.getByRole("button", { name: /Buscar genes candidatos/ }).click();

    await expect(page.getByText(/genphenia-inference-unreachable|No pudimos consultar GenPhenIA/i)).toBeVisible();
    // The user's work must survive the failure.
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible();
});

test("the clinical history box enforces the gateway's 10k character limit", async ({ page }) => {
    // services/api-gateway rejects text_es over 10000 chars with a 422, so the
    // textarea must cap input rather than let the request fail.
    await openDemoWizard(page);

    const box = page.getByPlaceholder(/Nena de 7 años/);
    await box.fill("a".repeat(10_500));
    expect((await box.inputValue()).length).toBeLessThanOrEqual(10_000);
});

test("a run cannot be submitted with no valid HPO code", async ({ page }) => {
    await openDemoWizard(page);
    // Clear the seeded example symptoms, then try to continue.
    const removeButtons = page.locator('button[aria-label^="Eliminar"]');
    for (let i = await removeButtons.count(); i > 0; i--) {
        await removeButtons.first().click();
    }
    await expect(removeButtons).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Revisar y continuar/ })).toBeDisabled();
});

test("demo mode does not offer to save the session", async ({ page }) => {
    await openDemoWizard(page);
    await expect(page.getByRole("button", { name: /Guardar diagnóstico/ })).toHaveCount(0);
});
