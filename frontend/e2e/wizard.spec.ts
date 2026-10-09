import { test, expect } from "@playwright/test";
import {
    acceptDemoTerms,
    mockModelServices,
    mockBackend,
    collectPageErrors,
    EXTRACT_FIXTURE,
    RANK_FIXTURE,
    fillBirthDate,
    openTextStep,
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
    await acceptDemoTerms(page);
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
    await fillBirthDate(page, "2018-04-03");
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

test("the birth date is typed as DD/MM/AAAA and the age reads in the unit that matters", async ({ page }) => {
    await mockBackend(page, { user: TEST_USER });
    await page.goto("/nuevo", { waitUntil: "networkidle" });
    const field = page.getByLabel(/^Fecha de nacimiento/);

    // Digits only: the slashes go in by themselves.
    await field.pressSequentially("03041966");
    await expect(field).toHaveValue("03/04/1966");
    await expect(page.getByText(/^Edad: \d+ años$/)).toBeVisible();

    await field.fill("31/02/2020");
    await expect(page.getByText("Esa fecha no existe. Revisá el día y el mes.")).toBeVisible();
    await field.fill("01/01/2999");
    await expect(page.getByText("La fecha de nacimiento no puede ser posterior a hoy.")).toBeVisible();

    await field.fill("12/3");
    await field.blur();
    await expect(page.getByText("Completá la fecha: DD/MM/AAAA.")).toBeVisible();
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

test("a typed birth date is saved as the date itself", async ({ page }) => {
    await mockBackend(page, { user: TEST_USER });
    await page.goto("/nuevo", { waitUntil: "networkidle" });
    await page.getByLabel(/^Fecha de nacimiento/).fill("03/04/2018");
    await page.getByRole("button", { name: /^Continuar$/ }).click();
    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("Infecciones respiratorias recurrentes").first()).toBeVisible();

    const saved = page.waitForRequest((req) => req.url().endsWith("/api/patients") && req.method() === "POST");
    await page.getByRole("button", { name: /Revisar y continuar/ }).click();
    await page.getByRole("button", { name: /Buscar genes candidatos/ }).click();
    expect((await saved).postDataJSON().fechaNacimiento).toBe("2018-04-03");
});

test("extracting symptoms from clinical text populates the HPO list", async ({ page }) => {
    await openTextStep(page);

    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();

    // Positive findings appear with their Spanish HPO labels.
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible();
    await expect(page.getByText("Talla baja")).toBeVisible();
});

test("a negated finding is not added as a present symptom", async ({ page }) => {
    // "sin convulsiones" must never become a symptom the model then ranks on.
    await openTextStep(page);

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
    await openTextStep(page);
    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();

    const negated = EXTRACT_FIXTURE.phenotypes.find((p) => p.negated)!;
    await expect(page.getByText("No presenta, según el texto")).toBeVisible();
    await page.getByRole("button", { name: new RegExp(`${negated.label_es}: sí lo presenta`) }).click();

    await expect(page.getByRole("button", { name: `Eliminar ${negated.label_es}` })).toBeVisible();
    await expect(page.getByText("No presenta, según el texto")).toHaveCount(0);
});

test("a negated finding never reaches the model", async ({ page }) => {
    await openTextStep(page);
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
    await openTextStep(page);
    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();

    await expect(page.getByText(/Puede tardar hasta un minuto/)).toBeVisible({ timeout: 9_000 });
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Puede tardar hasta un minuto/)).toHaveCount(0);
});

test("re-analysing unchanged text is refused with a reason, avoiding a redundant model call", async ({ page }) => {
    // The recognizer runs an LLM; re-sending identical text would spend it for
    // nothing, so the click explains why instead of calling it again.
    await openTextStep(page);
    let extractCalls = 0;
    page.on("request", (req) => {
        if (req.url().includes("/extract-hpo")) extractCalls += 1;
    });

    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible();
    expect(extractCalls).toBe(1);

    await page.getByRole("button", { name: /Analizar de nuevo/ }).click();
    await expect(page.getByText("Ya analizaste este texto. Si lo cambiás, podés analizarlo de nuevo.")).toBeVisible();
    expect(extractCalls).toBe(1);
});

test("an empty or too short text says so on the click", async ({ page }) => {
    await openTextStep(page);
    const box = page.getByPlaceholder(/Nena de 7 años/);
    const button = page.getByRole("button", { name: /Buscar síntomas en el texto/ });

    await button.click();
    await expect(page.getByText("Escribí o pegá un texto para buscar síntomas.")).toBeVisible();

    await box.fill("tos");
    await expect(page.getByText("Escribí o pegá un texto para buscar síntomas.")).toHaveCount(0);
    await button.click();
    await expect(page.getByText(/El texto es muy corto/)).toBeVisible();
});

test("re-analysing after an edit does not duplicate already-found symptoms", async ({ page }) => {
    await openTextStep(page);

    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible();

    // Edit the text so re-analysis unlocks; the mock returns the same phenotypes.
    await page.getByPlaceholder(/Nena de 7 años/).fill(`${HISTORIA} Sin fiebre.`);
    await page.getByRole("button", { name: /Analizar de nuevo/ }).click();

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
    await openTextStep(page);
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
    await openTextStep(page);

    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();

    await expect(page.getByRole("alert").filter({ hasText: "No pudimos analizar el texto" })).toBeVisible();
    await expect(page.getByText(/buscador/).first()).toBeVisible();
    await expect(page.getByText("extraction-failed")).toHaveCount(0);
});

test("a GenPhenAI outage surfaces an error and keeps the entered symptoms", async ({ page }) => {
    await mockModelServices(page, { rankStatus: 503, rankBody: { detail: "genphenia-inference-unreachable" } });
    await openTextStep(page);

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
    await openTextStep(page);

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
    await openTextStep(page);

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

test("analysing a text says how many symptoms it added", async ({ page }) => {
    await openTextStep(page);
    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();

    const present = EXTRACT_FIXTURE.phenotypes.filter((p) => !p.negated).length;
    await expect(page.getByRole("status").filter({ hasText: `Agregamos ${present} síntomas a la lista.` })).toBeVisible();
});

test("a half-typed birth date stops Continuar and says why, instead of being dropped", async ({ page }) => {
    await mockBackend(page, { user: TEST_USER });
    await page.goto("/nuevo", { waitUntil: "networkidle" });
    const field = page.getByLabel(/^Fecha de nacimiento/);
    await field.fill("12/3");

    await page.getByRole("button", { name: /^Continuar$/ }).click();
    await expect(page.getByText("Completá la fecha: DD/MM/AAAA.")).toBeVisible();
    await expect(field).toBeFocused();
    await expect(page.getByPlaceholder(/Nena de 7 años/)).toHaveCount(0);

    await field.fill("12/03/2018");
    await page.getByRole("button", { name: /^Continuar$/ }).click();
    await expect(page.getByPlaceholder(/Nena de 7 años/)).toBeVisible();
});

test("a reload keeps the search in progress, results included", async ({ page }) => {
    await openTextStep(page);
    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByRole("button", { name: "Eliminar Talla baja" })).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Síntomas del paciente");
    await expect(page.getByRole("button", { name: "Eliminar Talla baja" })).toBeVisible();

    await page.getByRole("button", { name: /Revisar y continuar/ }).click();
    await page.getByRole("button", { name: /Buscar genes candidatos/ }).click();
    await expect(page.getByText(RANK_FIXTURE.results[0].gene_symbol).first()).toBeVisible({ timeout: 20_000 });

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText(RANK_FIXTURE.results[0].gene_symbol).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Descargar resumen \(PDF\)/ })).toBeVisible();
});

test("the browser's back and forward buttons move between the steps", async ({ page }) => {
    await mockBackend(page, { user: TEST_USER });
    await page.goto("/nuevo", { waitUntil: "networkidle" });
    await page.getByLabel(/^Apodo/).fill("Juli");
    await page.getByRole("button", { name: /^Continuar$/ }).click();
    await expect(page.getByPlaceholder(/Nena de 7 años/)).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/nuevo$/);
    await expect(page.getByLabel(/^Apodo/)).toHaveValue("Juli");

    await page.goForward();
    await expect(page.getByPlaceholder(/Nena de 7 años/)).toBeVisible();
});

test("the confirmation is a dialog: Escape closes it and focus goes back", async ({ page }) => {
    await openTextStep(page);
    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    const review = page.getByRole("button", { name: /Revisar y continuar/ });
    await review.click();

    const dialog = page.getByRole("dialog", { name: "Confirmá los síntomas" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Seguir editando" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(review).toBeFocused();
});

test("the demo says text analysis needs an account instead of failing on the click", async ({ page }) => {
    let extractCalls = 0;
    page.on("request", (req) => {
        if (req.url().includes("/extract-hpo")) extractCalls += 1;
    });
    await openDemoWizard(page);

    await expect(page.getByText(/Buscar los síntomas en un relato escrito está disponible con una cuenta gratuita/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Crear una cuenta" })).toHaveAttribute("href", "/sign-up");
    await expect(page.getByPlaceholder(/Nena de 7 años/)).toHaveCount(0);
    expect(extractCalls).toBe(0);
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
