import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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

/**
 * The overview card for `symbol` in the results grid. The same in every
 * viewport: the grid only changes its column count.
 */
function geneRow(page: Page, symbol: string) {
    return page.getByRole("button", { name: new RegExp(`Gen ${symbol}\\b`) }).first();
}

/** Opens `symbol`'s detail modal and returns it. */
async function openGene(page: Page, symbol: string) {
    await geneRow(page, symbol).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("article", { name: `Detalle del gen ${symbol}` })).toBeVisible();
    return dialog;
}

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

    await expect(page.getByRole("heading", { name: /Genes para llevar a la consulta/ })).toBeVisible({
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

    const card = await openGene(page, "CFTR");
    await expect(card.getByText(/casete de unión a ATP/)).toBeVisible();
    expect(errors).toEqual([]);
});

test("no condition name appears on a card", async ({ page }) => {
    // On a card the condition would be the most legible text, so it would read
    // as the answer. The gene identifies the card; conditions live inside.
    await runToResults(page);

    await expect(geneRow(page, "SCNN1A")).toBeVisible();
    await expect(page.getByText("Pseudohipoaldosteronismo tipo 1")).toHaveCount(0);
    await expect(page.getByText("Fibrosis quística")).toHaveCount(0);
});

test("conditions appear inside, labelled as unordered and possibly incomplete", async ({ page }) => {
    // The model does not predict diseases. Presenting one as the headline would
    // pass our own OMIM annotation off as the model's output.
    await runToResults(page);

    const card = await openGene(page, "CFTR");
    await expect(card.getByRole("heading", { name: /CFTR/ })).toBeVisible();
    await expect(card.getByRole("heading", { name: /Condiciones asociadas/ })).toBeVisible();
    await expect(card.getByText(/Sin orden de relevancia/)).toBeVisible();
    await expect(card.getByText(/puede estar incompleta/)).toBeVisible();
    await expect(card.getByText("Fibrosis quística").first()).toBeVisible();
});

test("the unreported symptoms are medical-view only", async ({ page }) => {
    // "Preguntá por discapacidad intelectual (88%)" is read by a parent as a
    // thing to check their child against, whatever the panel says around it.
    // A clinician can weigh a frequency against a presentation; a family is
    // handed a verdict about a child.
    await runToResults(page);
    await page.getByLabel("Ver detalle médico").uncheck();

    await expect(page.getByText("Síntomas que no reportaste")).toHaveCount(0);
    await expect(page.getByText("Cloruro en sudor elevado")).toHaveCount(0);

    await page.getByLabel("Ver detalle médico").check();
    const card = await openGene(page, "CFTR");
    await expect(card.getByText("Síntomas que no reportaste")).toBeVisible();
});

test("a match is shown against the words the reader used", async ({ page }) => {
    // Shown in both views; pinned to the family one so a sticky preference
    // cannot decide what this asserts.
    // "Dijiste cuadros respiratorios a repetición" — their language, not HPO's.
    // It is what makes the claimed match checkable by the person reading it.
    await runToResults(page);

    const card = await openGene(page, "CFTR");
    await expect(card.getByText(/Dijiste/).first()).toBeVisible();
    await expect(card.getByText("Infecciones respiratorias recurrentes").first()).toBeVisible();
});

test("unreported signs are framed as questions, never as a self-check", async ({ page }) => {
    await runToResults(page);
    await page.getByLabel("Ver detalle médico").check();

    const card = await openGene(page, "CFTR");
    await expect(card.getByText(/no son cosas para evaluar por tu cuenta/i)).toBeVisible();
    await expect(card.getByText(/preguntá por ellos en la consulta/i)).toBeVisible();
});

test("no accuracy figure is promised", async ({ page }) => {
    // The hit rate moves with the model, the phenotypes and the disease. A
    // number on screen is read as a promise about this child.
    await runToResults(page);

    await expect(page.getByText(/9 de cada 10/i)).toHaveCount(0);
    await expect(page.getByText(/\d+ de cada \d+ casos/i)).toHaveCount(0);
    await expect(page.getByText(/el primero no es una respuesta/i)).toBeVisible();
});

test("a reported term counts once, however many annotations it reaches", async ({ page }) => {
    // "Convulsiones" subsumes six of ARX's annotations. Listing all six made
    // one thing the family said look like six pieces of evidence.
    await runToResults(page);

    // Read before opening: the modal hides the grid from the accessibility
    // tree. And only once the profile has arrived, or the meter reads 0.
    const meter = geneRow(page, "CFTR").getByRole("img", { name: /Coincide con \d+/ });
    await expect(meter).toBeVisible();
    const covered = Number((await meter.getAttribute("aria-label"))?.match(/Coincide con (\d+)/)?.[1]);
    const card = await openGene(page, "CFTR");

    // One row per reported term, matching the meter's own numerator.
    await expect(card.getByText(/^Dijiste/)).toHaveCount(covered);
});

test("the technical detail is hidden until the professional view is on", async ({ page }) => {
    // The rule is about what reaches the page: neither the cards nor the
    // modal may carry it with the box unchecked.
    await runToResults(page);
    await page.getByLabel("Ver detalle médico").uncheck();

    let card = await openGene(page, "CFTR");
    await expect(card.getByText("ABCC7")).toHaveCount(0);
    await expect(card.getByText(/Función de la proteína/)).toHaveCount(0);
    await expect(page.getByText("CF transmembrane conductance regulator")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.getByLabel("Ver detalle médico").check();

    card = await openGene(page, "CFTR");
    await expect(card.getByText(/ABCC7/)).toBeVisible();
    await expect(card.getByText("CF transmembrane conductance regulator")).toBeVisible();
});

test("the model's score is on the card, labelled as an ordering and not a probability", async ({ page }) => {
    await runToResults(page);
    await page.getByLabel("Ver detalle médico").uncheck();

    const score = geneRow(page, "CFTR").getByText(/^puntaje 0\.\d{3}$/);
    await expect(score).toBeVisible();
    await expect(score).toHaveAttribute("title", /no es una probabilidad/);
});

test("the professional view is remembered across visits", async ({ page }) => {
    await runToResults(page);
    await page.getByLabel("Ver detalle médico").check();

    await runToResults(page);

    await expect(page.getByLabel("Ver detalle médico")).toBeChecked();
});

test("a gene without a description still appears in the ranking", async ({ page }) => {
    // The model ranks over a gene set that can move ahead of the description
    // database. Losing the prose must never cost the user the result.
    await mockGeneProfiles(page, { available: false });
    await runToResults(page);

    // With no profile there is nothing to compare, which is its own state.
    await expect(geneRow(page, "CFTR").getByText(/Sin datos para comparar/)).toBeVisible();

    const card = await openGene(page, "CFTR");
    await expect(card.getByText(/Sin descripción disponible/)).toBeVisible();
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

    // Says which view it is about rather than relying on the default, since
    // the preference is deliberately sticky.
    await page.getByLabel("Ver detalle médico").uncheck();

    const card = await openGene(page, "CFTR");
    await expect(card.getByRole("link", { name: /Orphanet/ })).toBeVisible();
    await expect(card.getByRole("link", { name: /MedlinePlus en español/ })).toBeVisible();

    // The curated English databases stay in the technical view.
    await expect(card.getByRole("link", { name: /^NCBI Gene$/ })).toHaveCount(0);
    await expect(card.getByText(/no un diagnóstico/i)).toBeVisible();
});

test("the technical view adds the curated database links", async ({ page }) => {
    await runToResults(page);
    await page.getByLabel("Ver detalle médico").check();

    const card = await openGene(page, "CFTR");
    await expect(card.getByRole("link", { name: /NCBI Gene/ })).toBeVisible();
    await expect(card.getByRole("link", { name: /OMIM 219700/ })).toBeVisible();
});

test("every link opens safely in a new tab", async ({ page }) => {
    await runToResults(page);
    await page.getByLabel("Ver detalle médico").check();

    const links = (await openGene(page, "CFTR")).getByRole("link");
    expect(await links.count()).toBeGreaterThan(0);
    for (const link of await links.all()) {
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", /noopener/);
    }
});

test("the ranking keeps the model's order, ungrouped", async ({ page }) => {
    // Grouping by symptom overlap was tried and dropped: it pushed
    // top-scoring genes below a fold, and a heading over the genes that
    // matched nothing read as an apology for a result that is not a failure.
    await runToResults(page);

    await expect(page.getByRole("heading", { name: /Se relacionan con lo que contaste/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Sin relación con lo que contaste/ })).toHaveCount(0);
    await expect(page.getByText(/no los descarta/)).toHaveCount(0);

    const symbols = await page
        .locator("[data-gene-card]")
        .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-gene-card")));
    expect(symbols).toEqual(["CFTR", "DNAH5", "SCNN1A"]);
});

test("a gene with no symptom data still says so, without a heading to explain it", async ({ page }) => {
    // 10% of genes carry no symptom annotation. The row says what we have;
    // it just no longer needs a section to apologise for it.
    await runToResults(page);

    await expect(geneRow(page, "DNAH5").getByText("Sin datos para comparar")).toBeVisible();
    await expect(geneRow(page, "SCNN1A").getByText(/tenemos \d+ síntomas descritos/)).toBeVisible();
});

test("the locus rides with the medical detail, not with the gene's identity", async ({ page }) => {
    // A cytogenetic locus is meaningful to a clinician and noise to a family,
    // so it appears with the rest of the medical detail rather than
    // identifying the row.
    await runToResults(page);
    await page.getByLabel("Ver detalle médico").uncheck();
    await expect(page.getByText("7q31.2")).toHaveCount(0);

    await page.getByLabel("Ver detalle médico").check();
    await expect(page.getByText("7q31.2").first()).toBeVisible();
});

test("the symptom comparison comes before the gene's biology", async ({ page }) => {
    // The reader's question is "does this match my child", not "what does this
    // protein do". The summary used to open the card and run past 1,000 chars.
    await runToResults(page);

    const card = await openGene(page, "CFTR");
    const headings = await card.locator("h5").allTextContents();

    expect(headings[0]).toMatch(/Qué coincide/);
    expect(headings.indexOf("Qué se sabe del gen")).toBeGreaterThan(
        headings.findIndex((text) => /Qué coincide/.test(text)),
    );
});

test("the match count is framed as our comparison, not the model's reasoning", async ({ page }) => {
    // /rank-genes returns matched_count: 0 and never says why a gene ranked.
    // Anything we show about a match is computed by us and must read that way.
    await runToResults(page);

    // Both layouts say it, in their own words: the overlap is ours and the
    // model explains nothing. The wording differs, the claim must not.
    await page.getByLabel("Ver detalle médico").check();
    const card = await openGene(page, "CFTR");
    await expect(
        card.getByText(/hacemos nosotros|no aporta coincidencias propias/),
    ).toBeVisible();
    await expect(card.getByText(/el modelo (lo )?eligió porque|por esto el modelo/i)).toHaveCount(0);
});

test("the meter counts things reported, not symptoms matched", async ({ page }) => {
    // A gene can match several annotated symptoms that all trace back to one
    // thing the family said. The denominator is their own report, so it has to
    // be a count of that report.
    await runToResults(page);

    const meter = geneRow(page, "CFTR").getByRole("img", {
        name: /Coincide con \d+ de las \d+ cosas que contaste/,
    });
    await expect(meter).toBeVisible();
});

test("the provenance tail is stripped from the displayed summary", async ({ page }) => {
    // "[proporcionado por RefSeq, julio…]" is metadata. Beside an English
    // "[provided by RefSeq, Jul 2016]" it reads as broken text.
    await runToResults(page);

    await expect(page.getByText(/provided by RefSeq/i)).toHaveCount(0);
    await expect(page.getByText(/proporcionado por RefSeq/i)).toHaveCount(0);
});

test("symptoms added by hand are compared, not ignored", async ({ page }) => {
    // The meter read "0 de 0" on every gene in production. The comparison was
    // built from the raw output of a text analysis, which is empty whenever
    // symptoms were chosen from the autocomplete, edited, or restored from a
    // draft — so the backend was asked to compare against nothing, and every
    // gene fell into "sin relación con lo que contaste".
    //
    // The confirmed symptom list is the one the model ranks on, so it is the
    // one the comparison has to use.
    await page.route("**/hpo/es/search**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                results: [{ hpo_id: "HP:0002110", label_es: "Bronquiectasias", label: "Bronchiectasis" }],
            }),
        }),
    );

    await page.goto("/nuevo", { waitUntil: "networkidle" });
    await page.getByPlaceholder(/Ej\. Marcelo, Mamá/).fill("Paciente E2E");
    await page.locator('input[type="date"]').fill("2018-04-03");
    await page.getByPlaceholder("Ciudad o localidad").fill("CABA");
    await page.locator("select").filter({ hasText: "Argentina" }).selectOption("Argentina");
    await page.locator("select").filter({ hasText: "Femenino" }).selectOption("femenino");
    await page.getByRole("button", { name: /^Continuar$/ }).click();

    // The history is written but never analysed, so extractedPhenotypes stays
    // empty — the state a returning draft or a hand-built list arrives in.
    await page.getByPlaceholder(/Nena de 7 años/).fill(HISTORIA);
    await page.getByPlaceholder("Escribí un síntoma y elegí de la lista").fill("bronquiectasias");
    await page.getByText("Bronquiectasias").first().click();
    await page.getByRole("button", { name: /Revisar y continuar/ }).click();

    await page.getByRole("button", { name: /Buscar genes candidatos/ }).click();
    await expect(page.getByRole("heading", { name: /Genes para llevar a la consulta/ })).toBeVisible({
        timeout: 20_000,
    });

    // The denominator is the reader's own report: it cannot be zero when they
    // reported something.
    await expect(page.getByText(/0 de 0/)).toHaveCount(0);

    await expect(geneRow(page, "CFTR").getByText(/1 de 1/)).toBeVisible();
});

test("the gene opens GeneCards and OMIM, and each condition its own OMIM entry", async ({ page }) => {
    await runToResults(page);
    const detail = await openGene(page, "CFTR");

    await expect(detail.getByRole("link", { name: /^GeneCards/ })).toHaveAttribute(
        "href",
        "https://www.genecards.org/cgi-bin/carddisp.pl?gene=CFTR",
    );
    // The gene's own entry, not its disease's: 602421 is CFTR, 219700 is
    // cystic fibrosis.
    await expect(detail.getByRole("link", { name: /^OMIM/ })).toHaveAttribute(
        "href",
        "https://www.omim.org/entry/602421",
    );
    const condition = detail.getByRole("link", { name: /Fibrosis quística/ });
    await expect(condition).toHaveAttribute("href", "https://www.omim.org/entry/219700");
    await expect(condition).toHaveAttribute("target", "_blank");
});

test("a card shows what it matched, in small type, before anything is opened", async ({ page }) => {
    await runToResults(page);

    await expect(geneRow(page, "CFTR").getByText("Infecciones respiratorias recurrentes")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the modal steps through the ranking and closes back to the grid", async ({ page }) => {
    await runToResults(page);
    const dialog = await openGene(page, "CFTR");

    await expect(dialog.getByRole("button", { name: /Gen anterior/ })).toBeDisabled();
    await dialog.getByRole("button", { name: /Gen siguiente, DNAH5/ }).click();
    await expect(dialog.getByRole("article", { name: "Detalle del gen DNAH5" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Focus lands on the card of the gene last shown, not the top of the page.
    await expect(geneRow(page, "DNAH5")).toBeFocused();
});

test("the grid and the open modal pass the serious accessibility rules, contrast included", async ({ page }) => {
    // New surfaces, so no inherited contrast debt: small text uses
    // --lu-accent-text, never the accent itself. Reduced motion, because axe
    // measures contrast mid-fade otherwise and blames the text.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await runToResults(page);
    await page.getByLabel("Ver detalle médico").check();

    const serious = async (include: string) =>
        (
            await new AxeBuilder({ page })
                .include(include)
                .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
                .analyze()
        ).violations
            .filter((v) => v.impact === "serious" || v.impact === "critical")
            .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);

    expect(await serious("[data-gene-card]")).toEqual([]);
    expect(await serious('section[aria-labelledby="especialidades-titulo"]')).toEqual([]);
    await openGene(page, "CFTR");
    expect(await serious('[role="dialog"]')).toEqual([]);
});

test("the specialities follow the genes they are derived from", async ({ page }) => {
    await runToResults(page);

    const genes = page.getByRole("heading", { name: /Genes para llevar a la consulta/ });
    const areas = page.getByRole("heading", { name: "Especialidades para consultar" });
    await expect(areas).toBeVisible();
    const genesTop = (await genes.boundingBox())!.y;
    const areasTop = (await areas.boundingBox())!.y;
    expect(areasTop).toBeGreaterThan(genesTop);

    await expect(page.getByText("BETA", { exact: true })).toHaveCount(0);
});

test("a gene named under a speciality opens its detail", async ({ page }) => {
    await runToResults(page);

    await page.getByRole("button", { name: "Ver el gen DNAH5" }).click();
    await expect(page.getByRole("dialog").getByRole("article", { name: "Detalle del gen DNAH5" })).toBeVisible();
});

test("downloading the results is offered at the bottom, but not yet enabled", async ({ page }) => {
    await runToResults(page);

    const download = page.getByRole("button", { name: /Descargar resultados/ });
    await expect(download).toBeDisabled();
    const downloadTop = (await download.boundingBox())!.y;
    const disclaimerTop = (await page.getByText(/no constituye un diagnóstico médico/i).boundingBox())!.y;
    expect(downloadTop).toBeGreaterThan(disclaimerTop);
});
