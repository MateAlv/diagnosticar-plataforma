import { test, expect } from "@playwright/test";
import { mockBackend, mockModelServices, RANK_FIXTURE } from "./fixtures/services";

/**
 * A saved search, seen again from the history: the genes it ranked are there,
 * and the whole result opens where the PDF and the questions are.
 */

const USER = { id: "44444444-4444-4444-8444-444444444444", email: "familia@example.test", role: "user" };
const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const DIAGNOSIS_ID = "22222222-2222-4222-8222-222222222222";
const SYMPTOMS = [
    { description: "Infecciones respiratorias recurrentes", code: "HP:0002205" },
    { description: "Talla baja", code: "HP:0004322" },
];

test.beforeEach(async ({ page }) => {
    await mockModelServices(page);
    await mockBackend(page, {
        user: USER,
        patients: [
            {
                id: PATIENT_ID,
                nombre: "Juli",
                fecha_nacimiento: "2018-04-03",
                sexo: "femenino",
                localidad: null,
                pais: "Argentina",
                created_at: new Date().toISOString(),
                latest_diagnosis: {
                    id: DIAGNOSIS_ID,
                    historia_clinica: "",
                    symptoms_extracted: SYMPTOMS,
                    genphen_confidence: RANK_FIXTURE.confidence,
                    genphen_specialties: RANK_FIXTURE.specialties,
                    genphen_genes_top5: RANK_FIXTURE.results.slice(0, 5),
                    created_at: new Date().toISOString(),
                },
            },
        ],
    });
    await page.route(`**/api/patients/${PATIENT_ID}`, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ id: PATIENT_ID, nombre: "Juli", fecha_nacimiento: "2018-04-03", sexo: "femenino", localidad: null, pais: "Argentina" }),
        }),
    );
    await page.route(`**/api/patients/${PATIENT_ID}/diagnoses/${DIAGNOSIS_ID}`, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                id: DIAGNOSIS_ID,
                patient_id: PATIENT_ID,
                symptoms_extracted: SYMPTOMS,
                phenotypes: [],
                genphen_genes: RANK_FIXTURE.results,
                genphen_specialties: RANK_FIXTURE.specialties,
                genphen_confidence: RANK_FIXTURE.confidence,
            }),
        }),
    );
});

test("the history shows the genes and opens the whole result, PDF included", async ({ page }) => {
    await page.goto("/diagnosticar?tab=integrantes", { waitUntil: "networkidle" });
    const genes = page.getByRole("list").filter({ hasText: RANK_FIXTURE.results[0].gene_symbol });
    for (const gene of RANK_FIXTURE.results) await expect(genes.getByText(gene.gene_symbol)).toBeVisible();

    await page.getByRole("link", { name: "Ver el resultado completo" }).click();
    await expect(page).toHaveURL(new RegExp(`/nuevo\\?paciente=${PATIENT_ID}&diagnostico=${DIAGNOSIS_ID}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resultados orientativos");
    await expect(page.getByRole("button", { name: /Descargar resumen \(PDF\)/ })).toBeVisible();

    // Opening it was not a step of a new search: back returns to the history.
    await page.goBack();
    await expect(page).toHaveURL(/\/diagnosticar\?tab=integrantes$/);
});

test("a saved search that is gone says so and leads back to the list", async ({ page }) => {
    await page.route(`**/api/patients/${PATIENT_ID}/diagnoses/${DIAGNOSIS_ID}`, (route) =>
        route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not found", code: "not_found" }) }),
    );
    await page.goto(`/nuevo?paciente=${PATIENT_ID}&diagnostico=${DIAGNOSIS_ID}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("alert").filter({ hasText: /puede que se haya borrado/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Volver a mis búsquedas" })).toBeVisible();
});
