import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockBackend, mockHpoTree, mockModelServices, collectPageErrors, EXTRACT_FIXTURE, fillBirthDate } from "./fixtures/services";

/**
 * "¿A qué edad empezó este síntoma?" in the Precisar dialog. The extraction
 * here finds a seizure (an onset-informative term that cannot be refined) next
 * to "Infecciones respiratorias recurrentes", and the patient is
 * 8 years old. Onset is optional: with none given, the request to the model is
 * what it always was.
 */

const SHOTS = "/tmp/claude-1000/-home-mate-FIUBA-trabajo-profesional/b9805cfc-a24d-4af9-a308-191c12e58674/scratchpad";

const HISTORIA = "Nena de 7 años. Tiene convulsiones desde chiquita y tos todos los días.";

const TEST_USER = {
    id: "44444444-4444-4444-8444-444444444444",
    email: "familia@example.test",
    full_name: "Familia de Prueba",
    role: "user",
};

const seizurePresent = {
    ...EXTRACT_FIXTURE,
    phenotypes: EXTRACT_FIXTURE.phenotypes.map((p) => (p.hpo_id === "HP:0001250" ? { ...p, negated: false } : p)),
};

async function toSymptoms(page: Page) {
    await page.goto("/nuevo", { waitUntil: "networkidle" });
    await page.getByLabel(/^Apodo/).fill("Paciente E2E");
    await fillBirthDate(page, "2018-04-03");
    await page.getByPlaceholder("Ciudad o localidad").fill("CABA");
    await page.locator("select").filter({ hasText: "Argentina" }).selectOption("Argentina");
    await page.locator("select").filter({ hasText: "Femenino" }).selectOption("femenino");
    await page.getByRole("button", { name: /^Continuar$/ }).click();
    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("Infecciones respiratorias recurrentes").first()).toBeVisible();
}

const dialog = (page: Page) => page.getByTestId("refine-term-dialog");
const seizureButton = (page: Page) => page.getByRole("button", { name: /^Precisar .*[Cc]onvulsi.*: indicar a qué edad empezó$/ });

async function search(page: Page) {
    await page.getByRole("button", { name: /Revisar y continuar/ }).click();
    await page.getByRole("button", { name: /Buscar genes candidatos/ }).click();
}

test.beforeEach(async ({ page }) => {
    await mockBackend(page, { user: TEST_USER });
    await mockModelServices(page, { extractBody: seizurePresent });
});

test("an onset-informative symptom offers Precisar and asks only about the onset", async ({ page }) => {
    await toSymptoms(page);

    await seizureButton(page).click();
    await expect(dialog(page).getByRole("heading")).toContainText("¿Cuándo empezó");
    await expect(dialog(page).getByRole("group", { name: /¿A qué edad empezó este síntoma\?/ })).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: /^Elegir / })).toHaveCount(0);
    await expect(dialog(page)).toContainText("Hoy tiene 8 años");
    await expect(dialog(page).getByRole("radio", { name: "Después de los 60" })).toBeDisabled();
    await expect(dialog(page).getByRole("radio", { name: "Entre 1 y 5 años" })).toBeEnabled();
});

test("a chip is kept, shown on the symptom, edited and cleared", async ({ page }) => {
    await toSymptoms(page);
    await seizureButton(page).click();
    await dialog(page).getByRole("radio", { name: "Entre 1 y 5 años" }).check();
    await dialog(page).getByRole("button", { name: "Listo" }).click();
    await expect(page.getByText("Empezó: entre 1 y 5 años")).toBeVisible();

    await seizureButton(page).click();
    await expect(dialog(page).getByRole("radio", { name: "Entre 1 y 5 años" })).toBeChecked();
    await dialog(page).getByRole("radio", { name: "Entre 5 y 15 años" }).check();
    await dialog(page).getByRole("button", { name: "Borrar edad" }).click();
    await expect(dialog(page).getByRole("radio", { name: "No sé" })).toBeChecked();
    await dialog(page).getByRole("button", { name: /Dejarlo como está|Listo/ }).click();
    await expect(page.getByText(/Empezó:/)).toHaveCount(0);
});

test("an exact age picks the chip, and an age beyond the patient's is refused", async ({ page }) => {
    await toSymptoms(page);
    await seizureButton(page).click();
    const amount = dialog(page).getByRole("textbox", { name: /Edad exacta/ });
    await amount.fill("8");
    await expect(dialog(page).getByRole("radio", { name: "Entre 5 y 15 años" })).toBeChecked();
    await dialog(page).getByLabel("Unidad: años o meses").selectOption("months");
    await expect(dialog(page).getByRole("radio", { name: "Entre 1 y 12 meses" })).toBeChecked();
    await amount.fill("20");
    await expect(dialog(page).getByRole("radio", { name: "Entre 1 y 5 años" })).toBeChecked();
    await amount.fill("6");
    await expect(dialog(page).getByRole("radio", { name: "Entre 1 y 12 meses" })).toBeChecked();

    await dialog(page).getByLabel("Unidad: años o meses").selectOption("years");
    await amount.fill("30");
    await expect(dialog(page).getByRole("alert")).toContainText("No puede ser más que la edad actual");
    await expect(amount).toHaveAttribute("aria-invalid", "true");
    await expect(dialog(page).getByRole("radio", { name: "Entre 5 y 15 años" })).toBeChecked();
});

test("the chips work from the keyboard", async ({ page }) => {
    await toSymptoms(page);
    await seizureButton(page).click();
    await dialog(page).getByRole("radio", { name: "Al nacer" }).focus();
    await page.keyboard.press("Space");
    await expect(dialog(page).getByRole("radio", { name: "Al nacer" })).toBeChecked();
    await page.keyboard.press("ArrowRight");
    await expect(dialog(page).getByRole("radio", { name: "En el primer mes" })).toBeChecked();
});

test("a refinable symptom gets the onset question too, folded, with its value on the summary line", async ({ page }) => {
    await mockHpoTree(page);
    await toSymptoms(page);
    await page.getByRole("button", { name: "Precisar Talla baja: tiene tipos más específicos" }).click();
    await expect(dialog(page).getByRole("heading")).toHaveText("¿Qué tipo de «Talla baja»?");
    const radio = dialog(page).getByRole("radio", { name: "Entre 1 y 5 años" });
    await expect(radio).toBeHidden();
    await dialog(page).getByText("Agregar edad de inicio").click();
    await expect(dialog(page).getByRole("radiogroup", { name: "Edad de inicio" })).toBeVisible();
    await radio.check();
    await expect(dialog(page).getByText("Edad de inicio: Entre 1 y 5 años")).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "Listo" })).toBeVisible();
    await dialog(page).getByRole("button", { name: "Listo" }).click();

    await page.getByRole("button", { name: "Precisar Talla baja: tiene tipos más específicos" }).click();
    await expect(dialog(page).getByText("Edad de inicio: Entre 1 y 5 años")).toBeVisible();
    await expect(radio).toBeHidden();
});

test("without onset no onset field is sent; sex and age from the first step are", async ({ page }) => {
    const bodies: Record<string, unknown>[] = [];
    await page.route("**/rank-genes", async (route) => {
        bodies.push(route.request().postDataJSON());
        await route.fallback();
    });

    await toSymptoms(page);
    await search(page);
    await expect.poll(() => bodies.length).toBe(1);
    expect(Object.keys(bodies[0]).sort()).toEqual(["age_years", "hpo_ids", "sex", "top_k"]);
    expect(bodies[0]).toMatchObject({ sex: "female" });
    expect(bodies[0].age_years).toBeGreaterThan(8);
});

test("the onset is sent with the search and saved with the symptom", async ({ page }) => {
    const rank: Record<string, unknown>[] = [];
    const saved: { symptomsExtracted: Record<string, unknown>[] }[] = [];
    await page.route("**/rank-genes", async (route) => {
        rank.push(route.request().postDataJSON());
        await route.fallback();
    });
    await page.route("**/api/patients", async (route) => {
        if (route.request().method() === "POST") saved.push(route.request().postDataJSON());
        await route.fallback();
    });

    await toSymptoms(page);
    await seizureButton(page).click();
    await dialog(page).getByRole("textbox", { name: /Edad exacta/ }).fill("3");
    await dialog(page).getByRole("button", { name: "Listo" }).click();
    await search(page);

    await expect.poll(() => rank.length).toBe(1);
    expect(rank[0]).toMatchObject({
        onset_hpo_id: "HP:0011463",
        onset_age_years: 3,
        symptom_onsets: [{ hpo_id: "HP:0001250", onset_hpo_id: "HP:0011463", onset_age_years: 3 }],
        onset_years: 3,
    });
    await expect.poll(() => saved.length).toBe(1);
    const seizure = saved[0].symptomsExtracted.find((s) => s.code === "HP:0001250");
    expect(seizure?.onset).toEqual({ hpo_id: "HP:0011463", age_years: 3 });
});

test("the onset question meets WCAG 2.1 AA", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors = collectPageErrors(page);
    await toSymptoms(page);
    await seizureButton(page).click();
    await dialog(page).getByRole("radio", { name: "Entre 1 y 5 años" }).check();
    const results = await new AxeBuilder({ page })
        .include('[data-testid="refine-term-dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
    expect(results.violations).toEqual([]);
    expect(errors).toEqual([]);
});

const SEIZURE_LINE = "Inicio de los síntomas: a los 3 años (Convulsiones)";
const HINT = "Dato clínico informado por el paciente; no modifica el orden de genes";

async function diagnoseWithSeizureOnset(page: Page) {
    await toSymptoms(page);
    await seizureButton(page).click();
    await dialog(page).getByRole("textbox", { name: /Edad exacta/ }).fill("3");
    await dialog(page).getByRole("button", { name: "Listo" }).click();
    await search(page);
    await expect(page.getByRole("heading", { name: /Genes para llevar a la consulta/ })).toBeVisible({ timeout: 20_000 });
}

test("without onset the results show no onset section", async ({ page }) => {
    await toSymptoms(page);
    await search(page);
    await expect(page.getByRole("heading", { name: /Genes para llevar a la consulta/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-onset-report]")).toHaveCount(0);
    await expect(page.getByText(/Inicio de los síntomas/)).toHaveCount(0);
});

test("the onset shows in the results, in the saved consultation and in the summary to take along", async ({ page, context }, testInfo) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const saved: { symptomsExtracted: Record<string, unknown>[]; historiaClinica?: string }[] = [];
    await page.route("**/api/patients", async (route) => {
        if (route.request().method() === "POST") saved.push(route.request().postDataJSON());
        await route.fallback();
    });
    await diagnoseWithSeizureOnset(page);

    const report = page.locator("[data-onset-report]");
    await expect(report).toContainText("Convulsiones · empezó a los 3 años");
    await expect(report.getByText("Infecciones respiratorias recurrentes")).not.toContainText("empezó");
    await expect(report.locator("[data-onset-summary]")).toContainText(SEIZURE_LINE);
    await expect(report).toContainText(HINT);
    const axe = await new AxeBuilder({ page })
        .include("[data-onset-report]")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
    expect(axe.violations).toEqual([]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/results-${testInfo.project.name}.png`, fullPage: true });

    await expect.poll(() => saved.length).toBe(1);
    const stored = saved[0].symptomsExtracted;

    // Reopening the saved consultation, which stores onset inside symptoms_extracted.
    await page.unroute("**/api/patients");
    await page.route("**/api/patients", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([
                {
                    id: "11111111-1111-4111-8111-111111111111",
                    nombre: "Paciente E2E",
                    fecha_nacimiento: "2018-04-03",
                    sexo: "femenino",
                    localidad: "CABA",
                    pais: "Argentina",
                    created_at: new Date().toISOString(),
                    latest_diagnosis: {
                        id: "22222222-2222-4222-8222-222222222222",
                        historia_clinica: HISTORIA,
                        symptoms_extracted: stored,
                        genphen_confidence: null,
                        genphen_specialties: { top_specialties: [] },
                        genphen_genes_top5: [],
                        created_at: new Date().toISOString(),
                    },
                },
            ]),
        }),
    );
    await page.goto("/diagnosticar?tab=integrantes", { waitUntil: "networkidle" });
    const detail = page.locator("main").filter({ hasText: "Síntomas reportados" });
    await expect(detail.getByText("Convulsiones").first()).toBeVisible();
    await expect(detail.locator("[data-onset]")).toHaveCount(1);
    await expect(detail.locator("li", { hasText: "Convulsiones" })).toContainText("empezó a los 3 años");
    await expect(detail.locator("[data-onset-summary]")).toContainText(SEIZURE_LINE);
    await expect(detail.locator("[data-onset-summary]")).toContainText(HINT);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/saved-consultation-${testInfo.project.name}.png`, fullPage: true });

    // Regenerating starts from the same symptoms, onset included.
    await detail.getByRole("button", { name: "Volver a buscar" }).click();
    await expect(page.getByText("Empezó: entre 1 y 5 años")).toBeVisible();
});

test("the summary of the questions, copied and printed, carries the onset", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await diagnoseWithSeizureOnset(page);

    await page.locator("[data-question-launcher]").click();
    const panel = page.locator("[data-question-panel]");
    await panel.getByRole("button", { name: "Empezar las preguntas" }).click();
    await expect(panel.getByRole("heading", { name: "Ronda 1 de 3" })).toBeVisible();
    await panel.getByRole("button", { name: "Terminar acá" }).click();
    await panel.getByRole("button", { name: "Sí, terminar" }).click();
    await expect(panel.getByRole("heading", { name: "Para conversar en la consulta" })).toBeVisible();

    await expect(panel.locator("[data-onset-report]")).toContainText("Convulsiones · empezó a los 3 años");
    await expect(panel.locator("[data-onset-summary]")).toContainText(SEIZURE_LINE);
    await panel.getByRole("button", { name: "Copiar resumen" }).click();
    await expect(panel.getByRole("button", { name: "Resumen copiado" })).toBeVisible();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain(`Síntomas informados:\n${SEIZURE_LINE}\n- Convulsiones · empezó a los 3 años\n${HINT}.`);

    await page.emulateMedia({ media: "print" });
    await expect(panel.locator("[data-onset-report]")).toBeVisible();
});
