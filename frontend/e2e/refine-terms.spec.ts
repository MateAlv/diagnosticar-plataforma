import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockBackend, mockHpoTree, mockModelServices, collectPageErrors } from "./fixtures/services";

/**
 * A symptom so general it barely orders the ranking is flagged, and a dialog
 * lets the person browse down the HPO tree to a more specific form. Choosing
 * one replaces the symptom and closes the dialog; nothing is ever required.
 *
 * The extraction fixture yields two general terms — "Infecciones respiratorias
 * recurrentes" (437 genes) and "Talla baja" (952) — and a negated
 * "Convulsiones", which is not a present symptom and must not be flagged.
 */

const HISTORIA =
    "Nena de 7 años. Desde los 2 años tiene tos productiva casi todos los días, " +
    "con sibilancias y cuadros respiratorios a repetición. No tuvo convulsiones.";

const TEST_USER = {
    id: "44444444-4444-4444-8444-444444444444",
    email: "familia@example.test",
    full_name: "Familia de Prueba",
    role: "user",
};

async function toSymptoms(page: Page) {
    await page.goto("/nuevo", { waitUntil: "networkidle" });
    await page.getByPlaceholder(/Ej\. Marcelo, Mamá/).fill("Paciente E2E");
    await page.locator('input[type="date"]').fill("2018-04-03");
    await page.getByPlaceholder("Ciudad o localidad").fill("CABA");
    await page.locator("select").filter({ hasText: "Argentina" }).selectOption("Argentina");
    await page.locator("select").filter({ hasText: "Femenino" }).selectOption("femenino");
    await page.getByRole("button", { name: /^Continuar$/ }).click();
    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByRole("button", { name: /Buscar síntomas en el texto/ }).click();
    await expect(page.getByText("Infecciones respiratorias recurrentes").first()).toBeVisible();
}

const notice = (page: Page) => page.getByTestId("general-terms-notice");
const dialog = (page: Page) => page.getByTestId("refine-term-dialog");
const chips = (page: Page) => page.locator("ul li").filter({ has: page.getByRole("button", { name: /^Eliminar / }) });

test.beforeEach(async ({ page }) => {
    await mockBackend(page, { user: TEST_USER });
    await mockModelServices(page);
});

test("general symptoms are flagged with how many genes they reach, a negated one is not", async ({ page }) => {
    await mockHpoTree(page);
    await toSymptoms(page);

    await expect(notice(page)).toContainText("Hay 2 síntomas muy generales");
    await expect(notice(page)).toContainText("Infecciones respiratorias recurrentes · aparece en 437 genes");
    await expect(notice(page)).toContainText("Talla baja · aparece en 952 genes");
    await expect(notice(page)).not.toContainText("Convulsiones");
});

test("choosing a more specific form replaces the symptom and closes the dialog", async ({ page }) => {
    await mockHpoTree(page);
    const errors = collectPageErrors(page);
    await toSymptoms(page);

    await notice(page).getByRole("button", { name: "Precisar" }).first().click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole("heading")).toHaveText("¿Qué tipo de «Infecciones respiratorias recurrentes»?");

    // The forms that reach most genes come first.
    const options = dialog(page).getByRole("button", { name: /^Elegir / });
    await expect(options.first()).toHaveAccessibleName(/Infecciones recurrentes del tracto respiratorio inferior, aparece en 214 genes/);

    // One level down, then choose.
    await dialog(page).getByRole("button", { name: "Ver tipos de Infecciones recurrentes del tracto respiratorio inferior" }).click();
    await expect(dialog(page).getByRole("navigation", { name: "Dónde estás" })).toContainText(
        "Infecciones respiratorias recurrentes›Infecciones recurrentes del tracto respiratorio inferior",
    );
    const leaf = dialog(page).getByRole("button", { name: /^Elegir / }).first();
    const leafName = ((await leaf.getAttribute("aria-label")) ?? "").replace(/^Elegir /, "").replace(/, aparece en .*$/, "");
    await leaf.click();

    await expect(dialog(page)).toBeHidden();
    await expect(chips(page).filter({ hasText: leafName })).toHaveCount(1);
    await expect(chips(page).filter({ hasText: /^.*Infecciones respiratorias recurrentes/ })).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("the current level can be chosen, and the breadcrumb goes back", async ({ page }) => {
    await mockHpoTree(page);
    await toSymptoms(page);

    await notice(page).getByRole("button", { name: "Precisar" }).first().click();
    await dialog(page).getByRole("button", { name: "Ver tipos de Infecciones recurrentes del tracto respiratorio inferior" }).click();
    await dialog(page).getByRole("navigation", { name: "Dónde estás" }).getByRole("button", { name: "Infecciones respiratorias recurrentes" }).click();
    await expect(dialog(page).getByRole("navigation", { name: "Dónde estás" })).toHaveCount(0);

    await dialog(page).getByRole("button", { name: "Ver tipos de Infecciones recurrentes del tracto respiratorio inferior" }).click();
    await dialog(page).getByRole("button", { name: "Usar «Infecciones recurrentes del tracto respiratorio inferior»" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(chips(page).filter({ hasText: "Infecciones recurrentes del tracto respiratorio inferior" })).toHaveCount(1);
});

test("leaving it as it is changes nothing, and «Dejarlo así» stops asking", async ({ page }) => {
    await mockHpoTree(page);
    await toSymptoms(page);

    await notice(page).getByRole("button", { name: "Precisar" }).first().click();
    await dialog(page).getByRole("button", { name: "Dejarlo como está" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(chips(page).filter({ hasText: "Infecciones respiratorias recurrentes" })).toHaveCount(1);

    await notice(page).getByRole("button", { name: "Dejar Talla baja así" }).click();
    await expect(notice(page)).toContainText("Hay un síntoma muy general");
    await expect(notice(page)).not.toContainText("Talla baja");
    await expect(chips(page).filter({ hasText: "Talla baja" })).toHaveCount(1);
});

test("the chip itself offers to refine a general symptom", async ({ page }) => {
    await mockHpoTree(page);
    await toSymptoms(page);

    await page.getByRole("button", { name: "Precisar Talla baja: es un síntoma muy general" }).click();
    await expect(dialog(page).getByRole("heading")).toHaveText("¿Qué tipo de «Talla baja»?");
});

test("a failed load keeps the symptom and offers to retry", async ({ page }) => {
    await mockHpoTree(page, { failChildren: true });
    await toSymptoms(page);

    await notice(page).getByRole("button", { name: "Precisar" }).first().click();
    await expect(dialog(page)).toContainText("No pudimos cargar los tipos.");
    await expect(dialog(page).getByRole("button", { name: "Reintentar" })).toBeVisible();
    await dialog(page).getByRole("button", { name: "Dejarlo como está" }).click();
    await expect(chips(page).filter({ hasText: "Infecciones respiratorias recurrentes" })).toHaveCount(1);
});

test("without the tree nothing is flagged", async ({ page }) => {
    await toSymptoms(page);
    await expect(page.getByText("Talla baja").first()).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
});

test("the warning and the dialog meet WCAG 2.1 AA", async ({ page }) => {
    // The dialog fades in; measured mid-fade its colours are blended with the
    // page behind. Reduced motion turns the fade off, as it does for people
    // who ask for it.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockHpoTree(page);
    await toSymptoms(page);

    const scan = (selector: string) =>
        new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect((await scan('[data-testid="general-terms-notice"]')).violations).toEqual([]);
    await notice(page).getByRole("button", { name: "Precisar" }).first().click();
    await expect(dialog(page).getByRole("button", { name: /^Elegir / }).first()).toBeVisible();
    expect((await scan('[data-testid="refine-term-dialog"]')).violations).toEqual([]);
});
