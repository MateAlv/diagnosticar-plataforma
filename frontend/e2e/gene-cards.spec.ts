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

/**
 * Wide screens get a master-detail layout and narrow ones an accordion, so a
 * handful of these assertions only make sense on one of the two. This is the
 * breakpoint the page itself uses (Tailwind `lg`).
 */
function isDesktop(page: Page): boolean {
    return (page.viewportSize()?.width ?? 0) >= 1024;
}

/**
 * The pane showing one gene's detail, in whichever layout is on screen: the
 * detail column on a wide screen, the opened accordion row on a narrow one.
 * Both render the same content, so an assertion about that content should not
 * have to know which is which.
 */
function geneDetail(page: Page, symbol: string) {
    if (isDesktop(page)) {
        return page.getByRole("article", { name: `Detalle del gen ${symbol}` });
    }
    return page.getByRole("article").filter({ hasText: symbol }).first();
}

/**
 * The row for `symbol` in the ranking: the selectable list row on a wide
 * screen, the accordion article on a narrow one. This is where the meter and
 * its caption live in both layouts.
 */
function geneRow(page: Page, symbol: string) {
    if (isDesktop(page)) {
        return page.getByRole("button", { name: new RegExp(`Gen ${symbol}\\b`) }).first();
    }
    return page.getByRole("article").filter({ hasText: symbol }).first();
}

/** The control that opens `symbol`: the list row itself, or the row's toggle. */
function geneToggle(page: Page, symbol: string) {
    if (isDesktop(page)) return geneRow(page, symbol);
    return geneRow(page, symbol).getByRole("button", { name: new RegExp(symbol) }).first();
}

/** Opens `symbol` in whichever layout is on screen. */
async function openGene(page: Page, symbol: string) {
    const control = geneToggle(page, symbol);
    await expect(control).toBeVisible();

    // Wide screens select a row (aria-current); narrow ones disclose it
    // (aria-expanded). Either way, settle on the open state rather than
    // sampling it once: gene profiles arrive after the ranking and regroup it,
    // so a row read as closed can open a moment later and the click then
    // closes it again.
    const attr = isDesktop(page) ? "aria-current" : "aria-expanded";
    await expect(async () => {
        if ((await control.getAttribute(attr)) !== "true") await control.click();
        await expect(control).toHaveAttribute(attr, "true", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });

    return geneDetail(page, symbol);
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

    await expect(page.getByText(/casete de unión a ATP/)).toBeVisible();
    expect(errors).toEqual([]);
});

test("no condition name appears on a collapsed row", async ({ page }) => {
    test.skip(isDesktop(page), "accordion is the narrow-screen layout");
    // Our stored conditions can be the wrong ones — TCF4 holds only a type 2
    // diabetes susceptibility locus — and on a row the condition would be the
    // most legible text, so it would read as the answer. The gene identifies
    // the row; conditions live inside.
    await runToResults(page);

    const collapsed = page.getByRole("article").filter({ hasText: "SCNN1A" }).first();
    await expect(collapsed.getByRole("button", { name: /SCNN1A/ })).toHaveAttribute(
        "aria-expanded",
        "false",
    );
    await expect(collapsed.getByText("Pseudohipoaldosteronismo tipo 1")).toHaveCount(0);
});

test("conditions appear inside, labelled as unordered and possibly incomplete", async ({ page }) => {
    test.skip(isDesktop(page), "accordion is the narrow-screen layout");
    // The model does not predict diseases. Presenting one as the headline would
    // pass our own OMIM annotation off as the model's output.
    await runToResults(page);

    const card = await openGene(page, "CFTR");
    await expect(card.getByRole("heading", { name: /CFTR/ })).toBeVisible();
    await expect(
        card.getByRole("heading", { name: "Condiciones asociadas a este gen" }),
    ).toBeVisible();
    await expect(card.getByText(/No están ordenadas por relevancia/)).toBeVisible();
    await expect(card.getByText(/puede estar incompleta/)).toBeVisible();
    await expect(card.getByText("Fibrosis quística").first()).toBeVisible();
});

test("reported symptoms are separated from the ones to ask about", async ({ page }) => {
    await runToResults(page);

    const card = await openGene(page, "CFTR");
    await expect(card.getByText("Qué coincide")).toBeVisible();
    await expect(card.getByText("Para preguntar en la consulta")).toBeVisible();
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

test("unreported signs are framed as a question for a doctor", async ({ page }) => {
    // Never a self-assessment checklist: these are prompts to raise with a
    // clinician, not criteria a family should score themselves against.
    await runToResults(page);

    await expect(
        page.getByText(/No son cosas para evaluar por tu cuenta/i).first(),
    ).toBeVisible();
    await expect(page.getByText(/Anotalos y preguntá por ellos/i).first()).toBeVisible();
});

test("the accuracy of the model is stated, and as a top-20 claim", async ({ page }) => {
    await runToResults(page);

    // The count is the ranking's real length, not a hardcoded 20: the screen
    // used to promise 20 while listing 50.
    await expect(page.getByText(/entre los \d+ sugeridos/i)).toBeVisible();
    await expect(page.getByText(/no enfermedades ni\s+diagnósticos/i)).toBeVisible();
});

test("the technical detail is hidden until the professional view is on", async ({ page }) => {
    // The rule is about what reaches the page, not about the widget that
    // reveals it: the wide layout shows this inline, the narrow one behind a
    // toggle, and neither may leak it with the box unchecked.
    await runToResults(page);

    await expect(page.getByText(/score 0\./)).toHaveCount(0);
    await expect(page.getByText(/Puntaje del modelo/)).toHaveCount(0);
    await expect(page.getByText("ABCC7")).toHaveCount(0);

    await page.getByLabel("Vista profesional").check();

    const card = await openGene(page, "CFTR");
    if (isDesktop(page)) {
        await expect(card.getByText(/ABCC7/)).toBeVisible();
        await expect(card.getByText(/score 0\./)).toBeVisible();
    } else {
        await card.getByRole("button", { name: /Ver detalle técnico/ }).click();
        await expect(card.getByText(/Puntaje del modelo/)).toBeVisible();
        await expect(card.getByText(/Otros nombres/)).toBeVisible();
    }
});

test("the professional view is remembered across visits", async ({ page }) => {
    await runToResults(page);
    await page.getByLabel("Vista profesional").check();

    await runToResults(page);

    await expect(page.getByLabel("Vista profesional")).toBeChecked();
});

test("a gene without a description still appears in the ranking", async ({ page }) => {
    test.skip(isDesktop(page), "accordion is the narrow-screen layout");
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
    await page.getByLabel("Vista profesional").uncheck();

    const card = await openGene(page, "CFTR");
    await expect(card.getByRole("link", { name: /Orphanet/ })).toBeVisible();
    await expect(card.getByRole("link", { name: /MedlinePlus en español/ })).toBeVisible();

    // The curated English databases stay in the technical view.
    await expect(card.getByRole("link", { name: /^NCBI Gene$/ })).toHaveCount(0);
    await expect(card.getByText(/no un diagnóstico/i)).toBeVisible();
});

test("the technical view adds the curated database links", async ({ page }) => {
    await runToResults(page);
    await page.getByLabel("Vista profesional").check();

    const card = await openGene(page, "CFTR");
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
    test.skip(isDesktop(page), "accordion is the narrow-screen layout");
    // Half the curated summaries run past 600 characters and some reach 3,900.
    // Rendered in full they bury the symptom comparison below the fold.
    await runToResults(page);

    const card = await openGene(page, "CFTR");
    const expand = card.getByRole("button", { name: /Seguir leyendo/ });
    await expect(expand).toBeVisible();

    const clamped = card.locator("p.line-clamp-3");
    await expect(clamped).toHaveCount(1);

    await expand.click();
    await expect(card.locator("p.line-clamp-3")).toHaveCount(0);
    await expect(card.getByRole("button", { name: /Ver menos/ })).toBeVisible();
});

test("the summary opens closed, so 'Ver menos' never shows on first render", async ({ page }) => {
    test.skip(isDesktop(page), "accordion is the narrow-screen layout");
    // The label used to be computed from a state that did not match the clamp,
    // so cards nobody had touched offered to collapse themselves.
    await runToResults(page);

    await expect(page.getByRole("button", { name: /^Ver menos$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Seguir leyendo/ }).first()).toBeVisible();
});

test("the ranking is grouped by what it engages, not by position", async ({ page }) => {
    // The accuracy claim is about the set of 20, so position 1 and position 12
    // are not meaningfully different. Grouping answers the reader's actual
    // question — which of these engage what I described?
    await runToResults(page);

    await expect(page.getByRole("heading", { name: "Se relacionan con lo que contaste" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sin relación con lo que contaste" })).toBeVisible();

    // A gene that matched nothing is not ruled out, and the screen says so.
    await expect(page.getByText(/no los descarta/)).toBeVisible();
});

test("a gene with no symptom data is separated from one that simply did not match", async ({ page }) => {
    // 10% of genes carry no symptom annotation at all. Collapsing that into
    // "sin coincidencias" would report a gap in our data as a finding about
    // the gene.
    await runToResults(page);

    await expect(page.getByRole("heading", { name: "Todavía no podemos compararlos" })).toBeVisible();
    await expect(page.getByText(/no es evidencia en contra/)).toBeVisible();

    await expect(geneRow(page, "DNAH5").getByText("Sin datos para comparar")).toBeVisible();
    await expect(geneRow(page, "SCNN1A").getByText(/tenemos \d+ síntomas descritos/)).toBeVisible();
});

test("rows open independently, so two candidates can be compared", async ({ page }) => {
    test.skip(isDesktop(page), "accordion is the narrow-screen layout");
    await runToResults(page);

    const first = page.getByRole("article").filter({ hasText: "CFTR" }).first();
    await expect(first.getByRole("button", { name: /CFTR/ })).toHaveAttribute(
        "aria-expanded",
        "true",
    );

    const second = page.getByRole("article").filter({ hasText: "SCNN1A" }).first();
    const toggle = second.getByRole("button", { name: /SCNN1A/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Opening one must not close another.
    await expect(first.getByRole("button", { name: /CFTR/ })).toHaveAttribute(
        "aria-expanded",
        "true",
    );
});

test("the symptom comparison comes before the gene's biology", async ({ page }) => {
    test.skip(isDesktop(page), "accordion is the narrow-screen layout");
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
    await page.getByLabel("Vista profesional").check();
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
