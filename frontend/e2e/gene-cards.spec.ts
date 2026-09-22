import { test, expect, type Page } from "@playwright/test";
import {
    mockModelServices,
    mockBackend,
    mockGeneProfiles,
    collectPageErrors,
} from "./fixtures/services";

/**
 * The gene cards on the results screen.
 *
 * What is asserted here is mostly about *framing*, because that is where this
 * feature can do harm. The model predicts genes, not diseases: the correct gene
 * is in the top 20 in roughly 9 of 10 cases, and no disease is ever predicted.
 * A card that leads with a disease name, or that reads as a self-assessment
 * checklist, would misrepresent the system to a family looking for answers
 * about their child.
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

async function runToResults(page: Page) {
    await page.goto("/nuevo", { waitUntil: "networkidle" });

    await page.getByPlaceholder(/Ej\. Marcelo, Mamá/).fill("Paciente E2E");
    await page.locator('input[type="date"]').fill("2018-04-03");
    await page.getByPlaceholder("Ciudad o localidad").fill("CABA");
    await page.locator("select").filter({ hasText: "Argentina" }).selectOption("Argentina");
    await page.locator("select").filter({ hasText: "Femenino" }).selectOption("femenino");
    await page.getByRole("button", { name: /^Continuar$/ }).click();

    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("Infecciones respiratorias recurrentes")).toBeVisible();

    await page.getByRole("button", { name: /Revisar y continuar/ }).click();
    await page.getByRole("button", { name: /Buscar genes candidatos/ }).click();

    await expect(page.getByRole("heading", { name: /Genes para investigar/ })).toBeVisible({
        timeout: 20_000,
    });
}

test.beforeEach(async ({ page }) => {
    await mockBackend(page, { user: TEST_USER });
    await mockModelServices(page);
    await mockGeneProfiles(page);
});

test("a gene card shows the curated description", async ({ page }) => {
    const errors = collectPageErrors(page);
    await runToResults(page);

    await expect(page.getByText(/casete de unión a ATP/)).toBeVisible();
    expect(errors).toEqual([]);
});

test("the gene is the headline and the disease is labelled as context", async ({ page }) => {
    // The model does not predict diseases. Presenting one as the headline would
    // pass our own OMIM annotation off as the model's output.
    await runToResults(page);

    const card = page.getByRole("article").filter({ hasText: "CFTR" }).first();
    await expect(card.getByRole("heading", { name: /CFTR/ })).toBeVisible();
    await expect(card.getByText("Se estudia en relación con")).toBeVisible();
    await expect(card.getByText("Fibrosis quística")).toBeVisible();
});

test("reported symptoms are separated from the ones to ask about", async ({ page }) => {
    await runToResults(page);

    const card = page.getByRole("article").filter({ hasText: "CFTR" }).first();
    await expect(card.getByText("Coincide con lo que contaste")).toBeVisible();
    await expect(card.getByText("Otros signos frecuentes en estas condiciones")).toBeVisible();
});

test("unreported signs are framed as a question for a doctor", async ({ page }) => {
    // Never a self-assessment checklist: these are prompts to raise with a
    // clinician, not criteria a family should score themselves against.
    await runToResults(page);

    await expect(
        page.getByText(/Preguntale a tu médico si corresponde evaluarlos/i).first(),
    ).toBeVisible();
});

test("the accuracy of the model is stated, and as a top-20 claim", async ({ page }) => {
    await runToResults(page);

    await expect(page.getByText(/entre los 20 sugeridos/i)).toBeVisible();
    await expect(page.getByText(/no enfermedades ni\s+diagnósticos/i)).toBeVisible();
});

test("the technical detail is hidden until the professional view is on", async ({ page }) => {
    await runToResults(page);

    // Default view: no accessions, aliases or model score.
    await expect(page.getByRole("button", { name: /Ver detalle técnico/ })).toHaveCount(0);
    await expect(page.getByText(/Puntaje del modelo/)).toHaveCount(0);

    await page.getByLabel("Vista profesional").check();

    const card = page.getByRole("article").filter({ hasText: "CFTR" }).first();
    await card.getByRole("button", { name: /Ver detalle técnico/ }).click();
    await expect(card.getByText(/Puntaje del modelo/)).toBeVisible();
    await expect(card.getByText(/Otros nombres/)).toBeVisible();
});

test("the professional view is remembered across visits", async ({ page }) => {
    await runToResults(page);
    await page.getByLabel("Vista profesional").check();

    await runToResults(page);

    await expect(page.getByLabel("Vista profesional")).toBeChecked();
});

test("a gene without a description still appears in the ranking", async ({ page }) => {
    // The model ranks over a gene set that can move ahead of the description
    // database. Losing the prose must never cost the user the result.
    await mockGeneProfiles(page, { available: false });
    await runToResults(page);

    await expect(page.getByRole("article").filter({ hasText: "CFTR" }).first()).toBeVisible();
    await expect(page.getByText(/Sin descripción disponible/).first()).toBeVisible();
});

test("the disclaimer survives on a screen that now names diseases", async ({ page }) => {
    // Naming a disease is the most dangerous text this product shows, so the
    // regulatory disclaimer matters more here than it did before, not less.
    await runToResults(page);

    await expect(page.getByText(/no constituye un diagnóstico médico/i)).toBeVisible();
});

test("a family gets Spanish sources to read further, not English databases", async ({ page }) => {
    // "Researchable" has to mean researchable by the person reading it.
    await runToResults(page);

    const card = page.getByRole("article").filter({ hasText: "CFTR" }).first();
    await expect(card.getByRole("link", { name: /Orphanet/ })).toBeVisible();
    await expect(card.getByRole("link", { name: /MedlinePlus en español/ })).toBeVisible();

    // The curated English databases stay in the technical view.
    await expect(card.getByRole("link", { name: /^NCBI Gene$/ })).toHaveCount(0);
    await expect(card.getByText(/no un diagnóstico/i)).toBeVisible();
});

test("the technical view adds the curated database links", async ({ page }) => {
    await runToResults(page);
    await page.getByLabel("Vista profesional").check();

    const card = page.getByRole("article").filter({ hasText: "CFTR" }).first();
    await expect(card.getByRole("link", { name: /NCBI Gene/ })).toBeVisible();
    await expect(card.getByRole("link", { name: /OMIM 219700/ })).toBeVisible();
});

test("every link opens safely in a new tab", async ({ page }) => {
    await runToResults(page);

    const links = page.getByRole("article").first().getByRole("link");
    for (const link of await links.all()) {
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", /noopener/);
    }
});

test("a long description is clamped until the reader opens it", async ({ page }) => {
    // Half the curated summaries run past 600 characters and some reach 3,900.
    // Rendered in full they bury the symptom comparison below the fold.
    await runToResults(page);

    const card = page.getByRole("article").filter({ hasText: "CFTR" }).first();
    const expand = card.getByRole("button", { name: /Ver descripción completa/ });
    await expect(expand).toBeVisible();

    const clamped = card.locator("p.line-clamp-4");
    await expect(clamped).toHaveCount(1);

    await expand.click();
    await expect(card.locator("p.line-clamp-4")).toHaveCount(0);
    await expect(card.getByRole("button", { name: /Ver menos/ })).toBeVisible();
});
