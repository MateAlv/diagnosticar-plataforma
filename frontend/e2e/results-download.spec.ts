import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { mockBackend, mockGeneProfiles, mockModelServices, collectPageErrors, fillAgeFromBirthDate } from "./fixtures/services";

/**
 * The summary a family takes away: a PDF and the same text to copy. What it
 * must carry is checked against the file itself, not only the button.
 */

const TEST_USER = {
    id: "44444444-4444-4444-8444-444444444444",
    email: "familia@example.test",
    full_name: "Familia de Prueba",
    role: "user",
};

const HISTORIA =
    "Nena de 7 años. Desde los 2 años tiene tos productiva casi todos los días, " +
    "con sibilancias y cuadros respiratorios a repetición. No tuvo convulsiones.";

async function runToResults(page: Page) {
    await mockBackend(page, { user: TEST_USER });
    await mockModelServices(page);
    await mockGeneProfiles(page);
    await page.goto("/nuevo", { waitUntil: "networkidle" });
    await page.getByLabel(/^Apodo/).fill("Juli");
    await fillAgeFromBirthDate(page, "2019-04-03");
    await page.getByPlaceholder("Ciudad o localidad").fill("CABA");
    await page.locator("select").filter({ hasText: "Argentina" }).selectOption("Argentina");
    await page.locator("select").filter({ hasText: "Femenino" }).selectOption("femenino");
    await page.getByRole("button", { name: /^Continuar$/ }).click();
    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("Infecciones respiratorias recurrentes").first()).toBeVisible();
    await page.getByRole("button", { name: /Revisar y continuar/ }).click();
    await page.getByRole("button", { name: /Buscar genes candidatos/ }).click();
    await expect(page.getByRole("heading", { name: /Genes para llevar a la consulta/ })).toBeVisible({ timeout: 20_000 });
}

test("the PDF carries the reported profile, every gene with its link, and the warnings", async ({ page }) => {
    const errors = collectPageErrors(page);
    await runToResults(page);

    const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Descargar resumen (PDF)" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^diagnosticar-resumen-\d{4}-\d{2}-\d{2}\.pdf$/);

    const pdf = readFileSync((await download.path())!).toString("latin1");
    expect(pdf.startsWith("%PDF")).toBe(true);
    for (const text of [
        "Juli",
        "Perfil informado del paciente",
        "hpo.jax.org/browse/term/HP:",
        "Infecciones respiratorias recurrentes",
        "Convulsiones",
        "CFTR",
        "genecards.org/cgi-bin/carddisp.pl?gene=CFTR",
        "medlineplus.gov/spanish/genetica",
        "no constituye un diagn",
        "genética médica",
    ]) {
        expect(pdf, text).toContain(text);
    }
    expect(errors).toEqual([]);
});

test("the same summary can be copied as text", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "clipboard permissions are a Chromium feature");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await runToResults(page);

    await page.getByRole("button", { name: "Copiar como texto" }).click();
    await expect(page.getByRole("button", { name: "Copiado ✓" })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("Resumen de la búsqueda");
    expect(copied).toMatch(/^1\. CFTR( — .+)?\n   Ficha en GeneCards: https:\/\/www\.genecards\.org\/cgi-bin\/carddisp\.pl\?gene=CFTR$/m);
    expect(copied.indexOf("3. RESULTADO DEL MODELO")).toBeGreaterThan(copied.indexOf("2. QUÉ SON LAS ENFERMEDADES GENÉTICAS"));
    expect(copied).toMatch(/No presenta, según el relato:\n- Convulsiones \(HP:0001250\) — https:\/\/hpo\.jax\.org\/browse\/term\/HP:0001250/);
    expect(copied).toContain("Este resultado no constituye un diagnóstico médico.");
});
