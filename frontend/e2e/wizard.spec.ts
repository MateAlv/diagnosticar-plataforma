import { test, expect } from "@playwright/test";
import {
    mockModelServices,
    mockBackend,
    collectPageErrors,
    EXTRACT_FIXTURE,
    RANK_FIXTURE,
    fillAgeFromBirthDate,
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

    await page.getByLabel(/^Apodo/).fill("Paciente E2E");
    await fillAgeFromBirthDate(page, "2018-04-03");
    await page.getByPlaceholder("Ciudad o localidad").fill("CABA");
    await page.locator("select").filter({ hasText: "Argentina" }).selectOption("Argentina");
    await page.locator("select").filter({ hasText: "Femenino" }).selectOption("femenino");

    await page.getByRole("button", { name: /^Continuar$/ }).click();
}

test.beforeEach(async ({ page }) => {
    await mockBackend(page);
    await mockModelServices(page);
});

test("every basic datum is optional: Continuar works on an empty form, with Argentina preselected", async ({ page }) => {
    await mockBackend(page, { user: TEST_USER });
    await page.goto("/nuevo", { waitUntil: "networkidle" });

    await expect(page.getByLabel(/^País/)).toHaveValue("Argentina");
    await expect(page.getByLabel(/^Apodo/)).toHaveValue("");
    // Nothing on the form pushes the page sideways, on a phone either.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await page.getByRole("button", { name: /^Continuar$/ }).click();
    await expect(page.getByPlaceholder(/Nena de 7 años/)).toBeVisible();
});

test("skipping the step clears what was typed, the country included", async ({ page }) => {
    await mockBackend(page, { user: TEST_USER });
    await page.goto("/nuevo", { waitUntil: "networkidle" });
    await page.getByLabel(/^Apodo/).fill("Juli");

    await page.getByRole("button", { name: "Omitir este paso" }).click();
    await expect(page.getByPlaceholder(/Nena de 7 años/)).toBeVisible();
    await page.getByTitle("Ir a Datos básicos").click();
    await expect(page.getByLabel(/^Apodo/)).toHaveValue("");
    await expect(page.getByLabel(/^País/)).toHaveValue("");
});

test("the age picker counts in years and months, and months roll into years", async ({ page }) => {
    await mockBackend(page, { user: TEST_USER });
    await page.goto("/nuevo", { waitUntil: "networkidle" });
    const age = page.getByTestId("age-picker");

    await expect(age).toContainText("Sin indicar");
    await age.getByRole("button", { name: "Sumar un mes" }).click();
    await expect(age.getByLabel("Meses")).toHaveValue("1");
    await expect(age.getByLabel("Años")).toHaveValue("0");
    await age.getByLabel("Meses").fill("14");
    await expect(age.getByLabel("Años")).toHaveValue("1");
    await expect(age.getByLabel("Meses")).toHaveValue("2");
    await expect(age).toContainText("1 año y 2 meses");
    await age.getByRole("button", { name: "Restar un mes" }).click();
    await age.getByRole("button", { name: "Restar un mes" }).click();
    await age.getByRole("button", { name: "Restar un mes" }).click();
    await expect(age).toContainText("11 meses");
    await age.getByRole("button", { name: "Borrar" }).click();
    await expect(age).toContainText("Sin indicar");
});

test("a search saved without an apodo leaves the name to the server", async ({ page }) => {
    await mockBackend(page, { user: TEST_USER });
    await page.goto("/nuevo", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Omitir este paso" }).click();
    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("Infecciones respiratorias recurrentes").first()).toBeVisible();

    const saved = page.waitForRequest((req) => req.url().endsWith("/api/patients") && req.method() === "POST");
    await page.getByRole("button", { name: /Revisar y continuar/ }).click();
    await page.getByRole("button", { name: /Buscar genes candidatos/ }).click();
    const body = (await saved).postDataJSON();
    expect(body.nombre).toBe("");
    expect(body.pais).toBeNull();
    expect(body.fechaNacimiento).toBeNull();
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

    // Every present symptom carries its own remove button; a negated one has
    // none, because it is not in the list.
    const negated = EXTRACT_FIXTURE.phenotypes.find((p) => p.negated)!;
    await expect(
        page.getByRole("button", { name: `Eliminar ${negated.label_es}` }),
        "a negated phenotype was added as a present symptom",
    ).toHaveCount(0);
});

test("a negated finding is shown as not present, and can be moved back", async ({ page }) => {
    // Showing it is how a reader sees the negation was understood; moving it
    // back is how they fix an extractor that misread one.
    await openDemoWizard(page);
    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();

    const negated = EXTRACT_FIXTURE.phenotypes.find((p) => p.negated)!;
    await expect(page.getByText("No presenta, según el texto")).toBeVisible();
    await page.getByRole("button", { name: new RegExp(`${negated.label_es}: sí lo presenta`) }).click();

    await expect(page.getByRole("button", { name: `Eliminar ${negated.label_es}` })).toBeVisible();
    await expect(page.getByText("No presenta, según el texto")).toHaveCount(0);
});

test("a negated finding never reaches the model", async ({ page }) => {
    await openDemoWizard(page);
    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("No presenta, según el texto")).toBeVisible();

    const rankRequest = page.waitForRequest("**/rank-genes");
    await page.getByRole("button", { name: /Revisar y continuar/ }).click();
    await page.getByRole("button", { name: /Buscar genes candidatos/ }).click();

    const body = JSON.parse((await rankRequest).postData() ?? "{}");
    const negated = EXTRACT_FIXTURE.phenotypes.find((p) => p.negated)!;
    expect(body.hpo_ids).not.toContain(negated.hpo_id);
    expect(body.hpo_ids.length).toBeGreaterThan(0);
});

test("a slow extraction says it can take up to a minute", async ({ page }) => {
    // The Spanish symptom recognizer takes 20-40s on a long history; a bare
    // spinner that long reads as a hang, and people reload.
    await mockModelServices(page, { latencyMs: 10_000 });
    await openDemoWizard(page);
    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();

    await expect(page.getByText(/Puede tardar hasta un minuto/)).toBeVisible({ timeout: 9_000 });
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Puede tardar hasta un minuto/)).toHaveCount(0);
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

    await expect(page.getByRole("button", { name: /Analizar de nuevo/ })).toBeDisabled();
    await expect(page.getByText(/ya estaban en la lista/i)).toHaveCount(0);
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

    await expect(page.getByRole("alert").filter({ hasText: "No pudimos analizar el texto" })).toBeVisible();
    await expect(page.getByText(/buscador/).first()).toBeVisible();
    await expect(page.getByText("extraction-failed")).toHaveCount(0);
});

test("a GenPhenAI outage surfaces an error and keeps the entered symptoms", async ({ page }) => {
    await mockModelServices(page, { rankStatus: 503, rankBody: { detail: "genphenia-inference-unreachable" } });
    await openDemoWizard(page);

    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible();
    await page.getByRole("button", { name: /Revisar y continuar/ }).click();
    await page.getByRole("button", { name: /Buscar genes candidatos/ }).click();

    await expect(page.getByRole("alert").filter({ hasText: /se está iniciando/ })).toBeVisible();
    await expect(page.getByText("genphenia-inference-unreachable")).toHaveCount(0);
    // The user's work must survive the failure.
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible();
});

test("a structured model error is explained, never shown as [object Object]", async ({ page }) => {
    await mockModelServices(page, {
        rankStatus: 422,
        rankBody: { detail: { error: "no-known-hpo-ids", unknown_hpo_ids: ["HP:0002205"] } },
    });
    await openDemoWizard(page);

    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible();
    await page.getByRole("button", { name: /Revisar y continuar/ }).click();
    await page.getByRole("button", { name: /Buscar genes candidatos/ }).click();

    await expect(page.getByRole("alert").filter({ hasText: /Ninguno de los síntomas cargados/ })).toBeVisible();
    await expect(page.getByText(/object Object|no-known-hpo-ids/)).toHaveCount(0);
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

test("on a phone the header shows the whole logo and both actions on one line, with no sideways scroll", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "phone widths");
    await mockBackend(page, { user: TEST_USER });
    for (const width of [360, 412]) {
        await page.setViewportSize({ width, height: 780 });
        await page.goto("/nuevo", { waitUntil: "networkidle" });

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `sideways scroll at ${width}px`).toBeLessThanOrEqual(0);

        const logo = (await page.getByRole("link", { name: "Regresar al home" }).getByRole("img").boundingBox())!;
        expect(logo.x, `logo cut on the left at ${width}px`).toBeGreaterThanOrEqual(0);
        expect(logo.x + logo.width, `logo cut on the right at ${width}px`).toBeLessThanOrEqual(width);
        expect(logo.width, `logo squeezed at ${width}px`).toBeGreaterThan(120);

        for (const name of ["Cancelar", "Cerrar sesión"]) {
            const action = page.locator("header").getByRole("button", { name });
            await expect(action).toBeInViewport({ ratio: 1 });
            expect((await action.boundingBox())!.height, `"${name}" wraps at ${width}px`).toBeLessThanOrEqual(40);
        }
        // The account stays named for a screen reader; the logo is the way home.
        await expect(page.locator("header").getByText(TEST_USER.email)).toBeAttached();
        await expect(page.locator("header").getByRole("link", { name: "Home", exact: true })).toBeHidden();
    }
});
