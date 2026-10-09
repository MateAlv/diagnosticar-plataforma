import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
    mockModelServices,
    mockBackend,
    mockGeneProfiles,
    collectPageErrors,
    QUESTIONS_FIXTURE,
    SAVED_DIAGNOSIS_ID,
    type QuestionsMockOptions,
    fillBirthDate,
} from "./fixtures/services";

/**
 * The optional question loop on the results screen.
 *
 * What matters most here is what must not change: the result a family
 * already has survives every failure, the disclaimer is on screen while the
 * questions are, and the family view never turns a question into a gene or
 * a clinical rationale.
 *
 * The questions live in their own panel beside the results, hidden until the
 * reader asks for it: docked beside the grid from 1280 px, a drawer from
 * 768 px, a sheet below that. Every test runs on the desktop and phone
 * projects, so each one either holds in all three or says which it is about.
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

const [STOOL, SITUS, SWEAT] = QUESTIONS_FIXTURE.round1.questions;
const [SINUS, OTITIS, POTASSIUM] = QUESTIONS_FIXTURE.followUp.questions;
const MEDICO_TEXT = QUESTIONS_FIXTURE.medico.questions as Record<string, { text: string; help: string | null }>;
const SUMMARIES = QUESTIONS_FIXTURE.summaries;
const GENES = ["CFTR", "DNAH5", "SCNN1A"];
const DISCLAIMER = /no constituye un diagnóstico médico/i;
const DISCLAIMER_TEXT =
    "Este resultado no constituye un diagnóstico médico. Es una orientación generada por métodos computacionales basada en información genómica y fenotípica. Siempre consultá con un profesional médico calificado.";

type Answer = "Sí" | "No" | "No sé";
type Layout = "docked" | "drawer" | "sheet";

async function setup(page: Page, questions: QuestionsMockOptions = {}) {
    const { questions: engine } = await mockBackend(page, { user: TEST_USER, questions });
    await mockModelServices(page);
    await mockGeneProfiles(page);
    return engine;
}

/** Which frame the panel takes at this viewport, by the widths the design sets. */
function layoutOf(page: Page): Layout {
    const width = page.viewportSize()!.width;
    return width >= 1280 ? "docked" : width >= 768 ? "drawer" : "sheet";
}

async function answerAll(page: Page, texts: string[] = [STOOL.text, SITUS.text, SWEAT.text], values: Answer[] = ["Sí", "No", "No sé"]) {
    for (let i = 0; i < texts.length; i += 1) await answer(page, texts[i], values[i]);
}

function roundPosts(page: Page) {
    const bodies: Array<Record<string, unknown>> = [];
    page.on("request", (request) => {
        if (request.url().endsWith("/questions/rounds") && request.method() === "POST") {
            bodies.push(JSON.parse(request.postData() ?? "{}"));
        }
    });
    return bodies;
}

async function runToResults(page: Page, { medical = false } = {}) {
    await page.goto("/nuevo", { waitUntil: "networkidle" });

    await page.getByLabel(/^Apodo/).fill("Paciente E2E");
    await fillBirthDate(page, "2018-04-03");
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
    // Stated rather than inherited: the preference is sticky across visits.
    await page.getByLabel("Ver detalle médico").setChecked(medical);
}

function panel(page: Page) {
    return page.locator("[data-question-panel]");
}

function launcher(page: Page) {
    return page.locator("[data-question-launcher]");
}

async function openPanel(page: Page) {
    await launcher(page).click();
    await panelSettled(page);
}

/**
 * Waits for the panel to finish arriving: its slide over, and, for a drawer
 * or sheet, Radix's modal layer set up, which for a moment after mounting
 * leaves the content inheriting the page's disabled pointer events.
 */
async function panelSettled(page: Page) {
    await expect(panel(page)).toBeVisible();
    await panel(page).evaluate((frame) => Promise.all(frame.getAnimations().map((animation) => animation.finished)));
    await expect(panel(page)).toHaveCSS("pointer-events", "auto");
}

async function hidePanel(page: Page) {
    await panel(page).getByRole("button", { name: "Ocultar" }).click();
    await expect(panel(page)).toHaveCount(0);
}

/**
 * Brings the grid within reach. A drawer or sheet covers it and makes it
 * inert, so there the panel is hidden, as a reader would; docked, the grid
 * is already beside it.
 */
async function toTheList(page: Page) {
    if (layoutOf(page) !== "docked") await hidePanel(page);
}

/** Runs `act` on the page behind the panel, then brings the panel back. */
async function besideThePanel(page: Page, act: () => Promise<void>) {
    const covered = layoutOf(page) !== "docked";
    if (covered) await hidePanel(page);
    await act();
    if (covered) await openPanel(page);
}

function question(page: Page, text: string) {
    return panel(page).getByRole("group", { name: text });
}

/**
 * Taps an answer until it holds. A tap brings the next question into view
 * with a smooth scroll, which can still be moving the rows when the next tap
 * lands; a person waits for it, a test has to check.
 */
async function answer(page: Page, text: string, value: Answer) {
    const group = question(page, text);
    await expect(async () => {
        await group.getByRole("radiogroup").getByText(value, { exact: true }).click();
        await expect(group.getByRole("radio", { name: value, exact: true })).toBeChecked({ timeout: 500 });
    }).toPass();
}

function sendButton(page: Page) {
    return panel(page).getByRole("button", { name: /^Enviar respuestas/ });
}

async function send(page: Page) {
    await sendButton(page).click();
}

async function geneOrder(page: Page) {
    return page
        .locator("[data-gene-card]")
        .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-gene-card")));
}

async function startQuestions(page: Page) {
    const request = page.waitForRequest((r) => r.url().endsWith("/questions/rounds"));
    await openPanel(page);
    await panel(page).getByRole("button", { name: "Empezar las preguntas" }).click();
    await expect(panel(page).getByRole("heading", { name: "Ronda 1 de 3" })).toBeVisible();
    return JSON.parse((await request).postData() ?? "{}");
}

/** Starts from the panel without waiting for a round, for the tests about what comes back instead. */
async function askToStart(page: Page) {
    await openPanel(page);
    await panel(page).getByRole("button", { name: "Empezar las preguntas" }).click();
}

type ListName = "Con tus respuestas" | "Original";

// Read off the attribute: while a drawer or sheet is open the page behind it
// is aria-hidden, and these read its state rather than act on it.
async function expectList(page: Page, name: ListName) {
    await expect(page.locator("[data-list-toggle]")).toHaveAttribute(
        "data-showing",
        name === "Original" ? "original" : "refined",
    );
}

async function chooseList(page: Page, name: ListName) {
    const toggle = page.locator("[data-list-toggle]");
    const want = name === "Original" ? "original" : "refined";
    if ((await toggle.getAttribute("data-showing")) !== want) await toggle.click();
    await expectList(page, name);
}

async function terminate(page: Page) {
    await panel(page).getByRole("button", { name: "Terminar acá" }).click();
    await panel(page).getByRole("button", { name: "Sí, terminar" }).click();
}

async function seriousViolations(page: Page, include: string) {
    return (
        await new AxeBuilder({ page })
            .include(include)
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze()
    ).violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("a family answers a round and gets the summary; once the questions end the grid takes on the list with the answers", async ({ page }) => {
    const errors = collectPageErrors(page);
    await setup(page);
    await runToResults(page);
    expect(await geneOrder(page)).toEqual(["CFTR", "DNAH5", "SCNN1A"]);

    const start = await startQuestions(page);
    expect(start.mode).toBe("paciente");
    expect(start.answers).toBeUndefined();
    await expect(panel(page).getByRole("heading", { name: "Ronda 1 de 3" })).toBeFocused();

    // Never shown as disabled; it counts instead.
    await expect(sendButton(page)).toBeEnabled();
    await expect(sendButton(page)).toContainText("0 de 3");
    await answer(page, SWEAT.text, "Sí");
    await answer(page, SITUS.text, "No");
    await expect(sendButton(page)).toContainText("2 de 3");
    await answer(page, STOOL.text, "No sé");

    await question(page, SWEAT.text).getByRole("button", { name: "Agregar un comentario" }).click();
    await question(page, SWEAT.text).getByLabel("Comentario (opcional)").fill("se lo hicieron a los 3 años");
    await question(page, SWEAT.text).getByRole("button", { name: "Listo" }).click();
    // The note stays as a quote under the answer, and can be reopened.
    await expect(question(page, SWEAT.text).getByText("«se lo hicieron a los 3 años»")).toBeVisible();
    await expect(question(page, SWEAT.text).getByRole("button", { name: "Editar el comentario" })).toBeFocused();

    const answered = page.waitForRequest((r) => r.url().endsWith("/questions/rounds"));
    await send(page);
    const body = JSON.parse((await answered).postData() ?? "{}");
    expect(body.mode).toBe("paciente");
    expect(body.answers).toEqual([
        { hpoId: STOOL.hpoId, answer: "no_se" },
        { hpoId: SITUS.hpoId, answer: "no" },
        { hpoId: SWEAT.hpoId, answer: "si", note: "se lo hicieron a los 3 años" },
    ]);

    // The agent stopped there, so the order with the answers is applied.
    await expectList(page, "Con tus respuestas");
    expect(await geneOrder(page)).toEqual(["CFTR", "SCNN1A", "DNAH5"]);

    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeFocused();
    await expect(panel(page).locator("[data-summary]")).toHaveText(SUMMARIES.refined.paciente);
    await expect(panel(page)).toContainText("El primer gen de la lista ya se destacaba claramente sobre los demás, así que no hacían falta más preguntas.");

    // The answers, grouped by what was said and named by their label.
    const answers = panel(page).locator("[data-answers]");
    await expect(answers).toContainText(`Dijiste que sí · 1${SWEAT.label}`);
    await expect(answers).toContainText(`Dijiste que no · 1${SITUS.label}`);
    await expect(answers).toContainText(`No sabías · 1${STOOL.label}`);
    await expect(answers).toContainText("«se lo hicieron a los 3 años»");
    await expect(answers).not.toContainText(SWEAT.text);
    // Where the questions came from is the medical view's business.
    await expect(panel(page).getByText(/generaron sin IA/)).toHaveCount(0);

    await toTheList(page);
    await chooseList(page, "Original");
    // A "no" reaches no list: it is recorded with what they do not have,
    // whichever list is on screen, and said to change neither.
    await expect(page.locator("[data-from-questions]")).toHaveCount(0);
    await expect(page.getByText(`${SITUS.label} (de las preguntas)`)).toBeVisible();
    const notPresent = page.locator("[data-gene-panel] p").filter({ hasText: "No presenta:" });
    await expect(notPresent).toContainText("Quedan registrados para la consulta; hoy no cambian el orden de ninguna lista.");
    await expect(notPresent).not.toContainText(/reordenar|se usaron/i);

    await chooseList(page, "Con tus respuestas");
    expect(await geneOrder(page)).toEqual(["CFTR", "SCNN1A", "DNAH5"]);
    // With the answers' list on, a "sí" joins what they told us, marked as
    // coming from the questions: it was added to what the model analysed.
    // Both are named by the HPO label the agent sends, not by the question.
    const fromQuestions = page.locator("[data-from-questions]");
    await expect(fromQuestions).toHaveCount(1);
    await expect(fromQuestions).toContainText(SWEAT.label);
    await expect(fromQuestions).not.toContainText(SWEAT.text);
    await expect(page.getByText(`${SITUS.label} (de las preguntas)`)).toBeVisible();
    await expect(page.getByText(/No presenta:.*\(de las preguntas\)/)).not.toContainText(SITUS.text);
    // "No sé" is neither.
    await expect(page.locator("[data-gene-panel]").getByText(STOOL.label)).toHaveCount(0);

    // And it counts towards the comparison on each card.
    await expect(
        page.locator('[data-gene-card="CFTR"]').getByRole("img", { name: /Coincide con 2 de las 3 cosas/ }),
    ).toBeVisible();
    expect(errors).toEqual([]);
});

test("the questions live in their own panel, out of the gene list and hidden until asked for", async ({ page }) => {
    await setup(page);
    await runToResults(page);

    // Nothing sits between the genes and the specialities any more.
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Empezar las preguntas" })).toHaveCount(0);
    await expect(launcher(page)).toBeVisible();
    await expect(launcher(page)).toBeInViewport();
    await expect(launcher(page)).toHaveAttribute("data-question-launcher", "start");
    await expect(launcher(page)).toHaveAccessibleName(/Afinar la lista.*3 preguntas por ronda/);
    await expect(launcher(page)).toHaveAttribute("aria-expanded", "false");
    await expect(launcher(page)).toHaveAttribute("aria-controls", "panel-preguntas");

    await openPanel(page);
    await expect(launcher(page)).toHaveCount(0);
    await expect(panel(page)).toHaveAttribute("id", "panel-preguntas");
    const inGenes = await page.evaluate(() => {
        const questions = document.querySelector("[data-question-panel]")!;
        return document.querySelector("[data-gene-panel]")!.contains(questions);
    });
    expect(inGenes).toBe(false);

    // What opens it says what it costs and that nothing is lost.
    await expect(panel(page).getByRole("heading", { name: "¿Querés afinar la lista?" })).toBeFocused();
    for (const fact of ["3 preguntas por ronda", "hasta 3 rondas", "≈ 30 s por ronda"]) {
        await expect(panel(page).getByText(fact)).toBeVisible();
    }
    await expect(panel(page).getByText("Tu resultado original queda guardado y podés volver a él.")).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Empezar las preguntas" })).toBeInViewport();
    // "Ocultar", never "Cerrar": closing would sound like ending.
    await expect(panel(page).getByRole("button", { name: "Ocultar" })).toHaveAccessibleDescription(
        "Tus respuestas quedan guardadas",
    );
    await expect(panel(page).getByRole("button", { name: /Cerrar/ })).toHaveCount(0);
});

test("hiding the panel keeps every answer and note, and the launcher says where it was left", async ({ page }) => {
    await setup(page);
    const posts = roundPosts(page);
    await runToResults(page);
    await startQuestions(page);
    await answer(page, STOOL.text, "Sí");
    await answer(page, SITUS.text, "No");
    await question(page, SITUS.text).getByRole("button", { name: "Agregar un comentario" }).click();
    await question(page, SITUS.text).getByLabel("Comentario (opcional)").fill("nunca se lo vieron");

    await hidePanel(page);
    await expect(launcher(page)).toHaveAttribute("data-question-launcher", "continue");
    await expect(launcher(page)).toHaveAccessibleName(/Seguir con las preguntas.*Ronda 1 de 3/);
    await expect(launcher(page)).toBeFocused();

    await openPanel(page);
    await expect(question(page, STOOL.text).getByRole("radio", { name: "Sí" })).toBeChecked();
    await expect(question(page, SITUS.text).getByRole("radio", { name: "No", exact: true })).toBeChecked();
    await expect(question(page, SITUS.text).getByText("«nunca se lo vieron»")).toBeVisible();
    await expect(sendButton(page)).toContainText("2 de 3");

    await answer(page, SWEAT.text, "No sé");
    const answered = page.waitForRequest((r) => r.url().endsWith("/questions/rounds"));
    await send(page);
    expect(JSON.parse((await answered).postData() ?? "{}").answers).toEqual([
        { hpoId: STOOL.hpoId, answer: "si" },
        { hpoId: SITUS.hpoId, answer: "no", note: "nunca se lo vieron" },
        { hpoId: SWEAT.hpoId, answer: "no_se" },
    ]);
    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeVisible();
    expect(posts).toHaveLength(2);
});

test("the disclaimer stays on screen for as long as the panel is open", async ({ page }) => {
    // Regulatory: the questions are part of the result. The panel carries the
    // disclaimer in its header, which never scrolls away.
    await setup(page, { threeRounds: true });
    await runToResults(page, { medical: true });
    await startQuestions(page);

    const inPanel = panel(page).getByText(DISCLAIMER);
    await expect(inPanel).toHaveText(DISCLAIMER_TEXT);
    await expect(inPanel).toBeInViewport();

    await panel(page).locator("[data-panel-scroll]").evaluate((body) => body.scrollTo(0, body.scrollHeight));
    await expect(inPanel).toBeInViewport();
    // Docked, the page scrolls beside the panel; at its very end the panel
    // must still not be pushed up under the header.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(inPanel).toBeInViewport();
    await expect(sendButton(page)).toBeInViewport();

    // And the one at the foot of the results stays where it always was.
    const atFoot = page.locator("[data-gene-panel] ~ div").getByText(DISCLAIMER);
    await expect(atFoot).toHaveText(DISCLAIMER_TEXT);
});

test("the top of the results stays reachable after the questions", async ({ page }) => {
    // An overflow-hidden <main> used to be scrolled by scrollIntoView with no
    // way back: the view toggle and the way back to the original list were
    // left above the top of the page.
    await setup(page);
    await runToResults(page);
    await startQuestions(page);
    await expect(panel(page).getByRole("heading", { name: "Ronda 1 de 3" })).toBeInViewport();

    await answerAll(page);
    await send(page);
    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeInViewport();

    await toTheList(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    const scrolled = await page.evaluate(() =>
        [...document.querySelectorAll("*")]
            .filter((el) => el.scrollTop > 0 && !el.closest("[data-question-panel]"))
            .map((el) => el.tagName),
    );
    expect(scrolled).toEqual([]);
    await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
    await expect(page.getByLabel("Ver detalle médico")).toBeInViewport();
});

test("the medical view shows the HPO term, why each question is asked and the genes a «Sí» is associated with", async ({ page }) => {
    await setup(page);
    await runToResults(page, { medical: true });

    const start = await startQuestions(page);
    expect(start.mode).toBe("medico");

    const sweat = question(page, MEDICO_TEXT[SWEAT.hpoId].text);
    await expect(sweat.locator("[data-clinician]")).toContainText(`${SWEAT.hpoId}${SWEAT.label}`);
    await expect(sweat.getByText(SWEAT.rationale!)).toBeVisible();
    // One row, for a «Sí», and what it truly does: a «No» moves no gene.
    const associated = sweat.locator("[data-associated-genes]");
    await expect(associated.locator("dt")).toHaveText(["Asociado a"]);
    await expect(associated.locator("dd").getByRole("button")).toHaveText([/^CFTR\s*#1$/]);
    await expect(associated).toContainText("Un «Sí» se suma a los síntomas que usa el modelo.");
    await expect(panel(page).getByText(/Si responde/)).toHaveCount(0);
    await expect(panel(page).getByText(/Por qué preguntamos/)).toHaveCount(3);
    await expect(panel(page).locator("[data-mode-note]")).toHaveCount(0);

    // A gene named in a question opens its detail over the panel, and closing
    // it comes back here with the panel still open.
    const chip = question(page, MEDICO_TEXT[SITUS.hpoId].text)
        .locator("[data-associated-genes]")
        .getByRole("button", { name: /Ver el gen DNAH5, puesto 2/ });
    await chip.click();
    await expect(page.getByRole("dialog").getByRole("article", { name: "Detalle del gen DNAH5" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(chip).toBeFocused();
    await expect(panel(page)).toBeVisible();
});

test("the family view shows no genes, percentages or rationale, even if they arrive", async ({ page }) => {
    // The agent withholds them for mode "paciente"; this breaks that on
    // purpose, so the screen has to hold the line on its own.
    await setup(page, { leakMedicalFields: true });
    await runToResults(page);
    await startQuestions(page);

    await expect(panel(page).getByText(/Por qué preguntamos/)).toHaveCount(0);
    await expect(panel(page).locator("[data-associated-genes]")).toHaveCount(0);
    await expect(panel(page).locator("[data-clinician]")).toHaveCount(0);
    const text = await panel(page).innerText();
    for (const gene of GENES) expect(text).not.toContain(gene);
    expect(text).not.toMatch(/\d+\s*%/);
    expect(text).not.toMatch(/HP:\d/);
});

test("sending with a question unanswered shows which one, where the reader can see it", async ({ page }) => {
    await setup(page);
    const posts = roundPosts(page);
    await runToResults(page);
    await startQuestions(page);
    await answer(page, STOOL.text, "Sí");

    await send(page);
    expect(posts).toHaveLength(1);
    for (const text of [SITUS.text, SWEAT.text]) {
        await expect(question(page, text).getByText("Falta responder esta")).toBeVisible();
        await expect(question(page, text).getByRole("radiogroup")).toHaveAttribute("aria-invalid", "true");
    }
    await expect(question(page, STOOL.text).getByText("Falta responder esta")).toHaveCount(0);
    await expect(question(page, SITUS.text).getByRole("radiogroup")).toBeInViewport();
    await expect(question(page, SITUS.text).getByRole("radio", { name: "Sí" })).toBeFocused();
    await expect(panel(page).getByText("Te falta responder 2 preguntas.")).toBeAttached();

    // Answering one clears its mark and nothing else.
    await answer(page, SITUS.text, "No");
    await expect(question(page, SITUS.text).getByText("Falta responder esta")).toHaveCount(0);
    await expect(question(page, SWEAT.text).getByText("Falta responder esta")).toBeVisible();

    await answer(page, SWEAT.text, "No sé");
    await send(page);
    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeVisible();
    expect(posts).toHaveLength(2);
});

test("a tapped answer brings the next question into view, without moving focus; a keyed one does not scroll", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setup(page);
    await runToResults(page);
    await startQuestions(page);

    await answer(page, STOOL.text, "Sí");
    await expect(question(page, SITUS.text).getByRole("radiogroup")).toBeInViewport();
    const focusedQuestion = () =>
        page.evaluate(() => document.activeElement?.closest("[data-question]")?.getAttribute("data-question") ?? null);
    expect(await focusedQuestion()).not.toBe(SITUS.hpoId);

    // From the keyboard the reader is already where they mean to be.
    await question(page, SITUS.text).getByRole("radio", { name: "Sí" }).focus();
    const scrolls = () =>
        page.evaluate(() => [window.scrollY, document.querySelector("[data-panel-scroll]")!.scrollTop]);
    const before = await scrolls();
    await page.keyboard.press("Space");
    await expect(question(page, SITUS.text).getByRole("radio", { name: "Sí" })).toBeChecked();
    await page.waitForTimeout(300);
    expect(await scrolls()).toEqual(before);
    expect(await focusedQuestion()).toBe(SITUS.hpoId);
});

test("the send button stays on screen while the questions are", async ({ page }) => {
    await setup(page);
    await runToResults(page, { medical: true });
    await startQuestions(page);

    // The round is taller than the screen, so only a pinned bar keeps it in view.
    const round = await panel(page).locator("form").boundingBox();
    expect(round!.height).toBeGreaterThan(page.viewportSize()!.height);
    await expect(sendButton(page)).toBeInViewport();
    await question(page, MEDICO_TEXT[SITUS.hpoId].text).getByRole("radiogroup").scrollIntoViewIfNeeded();
    await expect(sendButton(page)).toBeInViewport();
});

test("ending asks once, in place, and only then finishes", async ({ page }) => {
    await setup(page);
    const posts = roundPosts(page);
    await runToResults(page);
    await startQuestions(page);

    await panel(page).getByRole("button", { name: "Terminar acá" }).click();
    const confirm = panel(page).getByRole("group", { name: /¿Terminar ahora\? Vas a ver el resumen con lo que respondiste/ });
    await expect(confirm).toBeVisible();
    await expect(confirm.locator("p")).toBeFocused();
    await confirm.getByRole("button", { name: "Seguir respondiendo" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: "Terminar acá" })).toBeFocused();
    expect(posts).toHaveLength(1);

    // A partly answered round is said to be dropped, and it is.
    await answer(page, STOOL.text, "Sí");
    await panel(page).getByRole("button", { name: "Terminar acá" }).click();
    await expect(panel(page).getByText(/Esta ronda quedó incompleta, así que no se envía/)).toBeVisible();
    const finish = page.waitForRequest((r) => r.url().endsWith("/questions/rounds"));
    await panel(page).getByRole("button", { name: "Sí, terminar" }).click();
    const body = JSON.parse((await finish).postData() ?? "{}");
    expect(body).toMatchObject({ finish: true });
    expect(body.answers).toBeUndefined();
    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeVisible();
});

test("finishing early leaves the original ranking as it was", async ({ page }) => {
    await setup(page);
    await runToResults(page);
    await startQuestions(page);

    await terminate(page);

    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeVisible();
    await expect(panel(page).getByText(SUMMARIES.early.paciente)).toBeVisible();
    await expect(panel(page).getByText(/volver a esta lista|quedaron guardadas/)).toHaveCount(0);
    await expect(panel(page).locator("[data-change-receipt]")).toHaveCount(0);
    await expect(page.locator("[data-list-toggle]")).toHaveCount(0);
    expect(await geneOrder(page)).toEqual(["CFTR", "DNAH5", "SCNN1A"]);
    await expect(panel(page).getByText(DISCLAIMER)).toBeVisible();
});

test("once the questions end the list with the answers is applied, with its own scores and a button back to the model's", async ({ page }) => {
    await setup(page);
    await runToResults(page);
    await startQuestions(page);
    await answerAll(page);
    await send(page);
    await expectList(page, "Con tus respuestas");
    await toTheList(page);

    const toggle = page.locator("[data-list-toggle]");
    await expect(toggle).toHaveText(/Volver a la lista inicial/);
    await expect(page.locator("[data-list-note]")).toHaveText(
        "La lista con tus respuestas es orientativa: todavía estamos evaluando si mejora el orden.",
    );
    expect(await geneOrder(page)).toEqual(["CFTR", "SCNN1A", "DNAH5"]);
    await expect(page.locator("[data-from-questions]")).toHaveText([`${STOOL.label} · de las preguntas↗`]);
    // Each card shows the score of the list with the answers, not a move.
    const notes = page.locator("[data-gene-card] [data-rank-note]");
    await expect(notes).toHaveText(["puntaje 0.810", "puntaje 0.090", "puntaje 0.050"]);
    await expect(notes.first()).toHaveAttribute("title", /^Puntaje con tus respuestas/);
    // 0.8 or more is marked, with an outline and in words.
    const cftr = page.locator('[data-gene-card="CFTR"]');
    await expect(cftr).toHaveAttribute("data-high-score", "true");
    await expect(cftr.locator("[data-high-score-badge]")).toHaveText("Puntaje alto");
    await expect(page.locator("[data-high-score]")).toHaveCount(1);

    const announcement = page.locator("[data-gene-panel] [aria-live]");
    await toggle.click();
    await expectList(page, "Original");
    await expect(announcement).toHaveText("Mostrando la lista original del modelo.");
    await expect(toggle).toHaveText("Ver la lista con tus respuestas");
    expect(await geneOrder(page)).toEqual(["CFTR", "DNAH5", "SCNN1A"]);
    await expect(notes).toHaveText(["puntaje 0.412", "puntaje 0.201", "puntaje 0.087"]);
    await expect(notes.first()).toHaveAttribute("title", /^Puntaje del modelo/);
    await expect(page.locator("[data-high-score]")).toHaveCount(0);
    // The «Sí» leaves with the list it was added to; the «No» stays, recorded.
    await expect(page.locator("[data-from-questions]")).toHaveCount(0);
    await expect(page.getByText(`${SITUS.label} (de las preguntas)`)).toBeVisible();

    await toggle.click();
    await expectList(page, "Con tus respuestas");
    await expect(announcement).toHaveText("Mostrando la lista con tus respuestas.");
});

test("the choice of list holds through the next round, and a round never puts the answers' list on by itself", async ({ page }) => {
    await setup(page, { threeRounds: true });
    await runToResults(page);
    await startQuestions(page);
    await answerAll(page, undefined, ["No", "No", "No sé"]);
    await send(page);
    await expect(panel(page).getByRole("heading", { name: "Ronda 2 de 3" })).toBeVisible();
    await expectList(page, "Original");

    await besideThePanel(page, () => chooseList(page, "Con tus respuestas"));
    await answerAll(page, [SINUS.text, OTITIS.text, POTASSIUM.text], ["Sí", "No", "No"]);
    await send(page);
    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeVisible();
    await expectList(page, "Con tus respuestas");
    expect(await geneOrder(page)).toEqual(["CFTR", "SCNN1A", "DNAH5"]);
});

for (const medical of [false, true]) {
    test(`the answers' list shows each gene's new score, and the detail says what moved it (${medical ? "medical" : "family"} view)`, async ({ page }) => {
        await setup(page);
        await runToResults(page, { medical });
        await startQuestions(page);
        const texts = medical
            ? [STOOL, SITUS, SWEAT].map((q) => MEDICO_TEXT[q.hpoId].text)
            : [STOOL.text, SITUS.text, SWEAT.text];
        await answerAll(page, texts);
        await send(page);
        await toTheList(page);
        await expectList(page, "Con tus respuestas");

        const notes = page.locator("[data-gene-card] [data-rank-note]");
        await expect(notes).toHaveText(["puntaje 0.810", "puntaje 0.090", "puntaje 0.050"]);
        await expect(page.locator("[data-gene-card] [data-direction]")).toHaveCount(0);

        await page.locator('[data-gene-card="DNAH5"]').click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.locator("[data-rank-note]")).toHaveText("puntaje 0.050");
        // The same in both views, and crediting no answer: the model ranked again.
        await expect(dialog.locator("[data-move-note]")).toHaveText(
            "Se movió cuando el modelo volvió a ordenar la lista con los síntomas que confirmaste.",
        );
        await page.keyboard.press("Escape");
        await page.locator('[data-gene-card="CFTR"]').click();
        await expect(page.getByRole("dialog").locator("[data-move-note]")).toHaveCount(0);
    });
}

test("the specialities follow the list on screen: the model's first, the re-run's with the answers", async ({ page }) => {
    await setup(page);
    await runToResults(page);
    await startQuestions(page);
    await answerAll(page);
    await send(page);
    await toTheList(page);

    // Gastroenterology: SCNN1A alone in the model's list; CFTR joins it in
    // the re-run with the confirmed findings.
    const gastro = page.locator("li").filter({ hasText: /^Gastroenterología/ }).filter({ hasText: "de 3 genes" });
    await expect(gastro).toContainText("2 de 3 genes");
    await expect(gastro.getByRole("button")).toHaveText(["CFTR", "SCNN1A"]);

    await chooseList(page, "Original");
    await expect(gastro).toContainText("1 de 3 genes");
    await expect(gastro.getByRole("button")).toHaveText(["SCNN1A"]);

    await chooseList(page, "Con tus respuestas");
    await expect(gastro).toContainText("2 de 3 genes");
});

test("a gene the list before the questions did not have enters as new, and one that left is named", async ({ page }) => {
    const engine = await setup(page);
    // As the agent sends it: re-ranked with the confirmed findings, and each
    // modelRank is the gene's place in this list, not where it came from.
    await page.route("**/api/questions/rounds", async (route) => {
        const result = engine.round(JSON.parse(route.request().postData() ?? "{}"));
        const body = result.body as { ranking?: Array<{ geneId: string; geneSymbol: string; score: number; modelRank: number }> };
        if (body.ranking && body.ranking.some((row) => row.geneSymbol === "SCNN1A") && result.body.status === "finished") {
            body.ranking = [
                { geneId: "CFTR", geneSymbol: "CFTR", score: 0.7, modelRank: 1 },
                { geneId: "DNAI1", geneSymbol: "DNAI1", score: 0.2, modelRank: 2 },
                { geneId: "SCNN1A", geneSymbol: "SCNN1A", score: 0.1, modelRank: 3 },
            ];
        }
        await route.fulfill({ status: result.status, contentType: "application/json", body: JSON.stringify(result.body) });
    });
    await runToResults(page);
    await startQuestions(page);
    await answerAll(page);
    await send(page);
    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeVisible();

    const receipt = panel(page).locator("[data-change-receipt]");
    await expect(receipt.getByRole("listitem")).toHaveText([/DNAI1\s*nuevo/, /CFTR\s*= 1\.º/]);
    await expect(receipt.locator("[data-dropped]")).toHaveText("Quedaron fuera de esta lista: DNAH5.");

    await toTheList(page);
    await expectList(page, "Con tus respuestas");
    await expect(page.locator("[data-gene-card] [data-rank-note]")).toHaveText(["puntaje 0.700", "puntaje 0.200", "puntaje 0.100"]);
    await page.locator('[data-gene-card="DNAI1"]').click();
    await expect(page.getByRole("dialog").locator("[data-move-note]")).toHaveText(
        "Entró en la lista cuando el modelo la volvió a ordenar con los síntomas que confirmaste.",
    );
});

test("toggling between the model's list and the answers' list never refetches or blanks the descriptions", async ({ page }) => {
    await setup(page);
    let batches = 0;
    page.on("request", (request) => {
        if (request.url().includes("/genes/batch")) batches += 1;
    });
    await runToResults(page);
    await startQuestions(page);
    await answerAll(page);
    await send(page);
    await toTheList(page);
    const cftrMeter = page.locator('[data-gene-card="CFTR"]').getByRole("img", { name: /Coincide con/ });
    await expect(cftrMeter).toBeVisible();
    // One batch for the answers' list, applied when the questions end, whose
    // "Sí" answers change what the profiles are compared against.
    await expect.poll(() => batches).toBe(2);
    const settled = batches;

    for (let i = 0; i < 3; i += 1) {
        await chooseList(page, "Original");
        await expect(cftrMeter).toBeVisible();
        await chooseList(page, "Con tus respuestas");
        await expect(cftrMeter).toBeVisible();
    }
    expect(batches).toBe(settled);
});

test("the grid slides only when the reader switches lists: not when a round lands, and not with less motion", async ({ page }) => {
    await page.addInitScript(() => {
        const original = Element.prototype.animate;
        (window as unknown as { __slides: number }).__slides = 0;
        Element.prototype.animate = function (this: Element, ...args: Parameters<Element["animate"]>) {
            if (this instanceof HTMLElement && this.dataset.flipKey) {
                (window as unknown as { __slides: number }).__slides += 1;
            }
            return original.apply(this, args);
        };
    });
    const slides = () => page.evaluate(() => (window as unknown as { __slides: number }).__slides);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const engine = await setup(page, { threeRounds: true });
    await runToResults(page);
    await startQuestions(page);
    await answerAll(page);
    await send(page);
    await expect(panel(page).getByRole("heading", { name: "Ronda 2 de 3" })).toBeVisible();
    expect(await slides()).toBe(0);

    await besideThePanel(page, () => chooseList(page, "Con tus respuestas"));
    expect(await geneOrder(page)).toEqual(["CFTR", "SCNN1A", "DNAH5"]);
    expect(await slides()).toBe(0);

    // The last round puts DNAH5 first, reordering the answers' list on
    // screen: that one just happens, with motion allowed or not.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.route("**/api/questions/rounds", async (route) => {
        const result = engine.round(JSON.parse(route.request().postData() ?? "{}"));
        const ranking = result.body.ranking as Array<{ geneSymbol: string }> | undefined;
        if (ranking) result.body.ranking = ["DNAH5", "CFTR", "SCNN1A"].map((gene) => ranking.find((row) => row.geneSymbol === gene)!);
        await route.fulfill({ status: result.status, contentType: "application/json", body: JSON.stringify(result.body) });
    });
    await answerAll(page, [SINUS.text, OTITIS.text, POTASSIUM.text], ["Sí", "No", "No"]);
    await send(page);
    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeVisible();
    await expect.poll(() => geneOrder(page)).toEqual(["DNAH5", "CFTR", "SCNN1A"]);
    await page.waitForTimeout(300);
    expect(await slides()).toBe(0);

    // Switching is the reader's own doing, and slides: DNAH5 and CFTR trade
    // places, and a card whose row changed height may follow.
    await toTheList(page);
    await chooseList(page, "Original");
    expect(await geneOrder(page)).toEqual(["CFTR", "DNAH5", "SCNN1A"]);
    await expect.poll(slides).toBeGreaterThanOrEqual(2);
});

test("a second round opens with what the last answers changed (family view)", async ({ page }) => {
    await setup(page, { threeRounds: true });
    await runToResults(page);
    await startQuestions(page);
    await expect(panel(page).locator("[data-change-receipt]")).toHaveCount(0);
    await answerAll(page, undefined, ["No", "No", "No sé"]);
    await send(page);

    await expect(panel(page).getByRole("heading", { name: "Ronda 2 de 3" })).toBeFocused();
    const receipt = panel(page).locator("[data-change-receipt]");
    await expect(receipt.getByRole("heading", { name: "Qué cambió con tus respuestas" })).toBeVisible();
    await expect(receipt).toContainText("Respecto de la lista original");
    await expect(receipt.locator("[data-direction]")).toHaveText(["↑ 3.º → 2.º", "↓ 2.º → 3.º", "= 1.º"]);
    await expect(receipt.getByRole("button", { name: /Ver el gen SCNN1A/ })).toHaveAccessibleName(
        /SCNN1A.*Subió del puesto 3 al 2 con tus respuestas/,
    );
    // A place in a list, never a likelihood, and no move credited to an answer.
    await expect(receipt).not.toContainText(/probab|por (Sí|No) a/i);
    await expect(receipt.locator("[data-rerank-note]")).toHaveText(
        "El modelo volvió a ordenar la lista con los síntomas que confirmaste.",
    );
    await expect(question(page, SINUS.text)).toBeVisible();
    await expect(panel(page).locator("[data-associated-genes]")).toHaveCount(0);

    await expectList(page, "Original");
    if (layoutOf(page) !== "docked") {
        // Over the list, the banner says there is another order; reopened
        // after a look, the receipt's own link does the same.
        await expect(panel(page).locator("[data-list-updated]")).toContainText("Hay una lista con tus respuestas");
        await besideThePanel(page, async () => {});
    }
    await receipt.getByRole("button", { name: /Ver la lista con tus respuestas/ }).click();
    await expectList(page, "Con tus respuestas");
    const genes = page.getByRole("heading", { name: /Genes para llevar a la consulta/ });
    await expect(genes).toBeFocused();
    await expect(genes).toBeInViewport();
    // Docked, the list is beside the panel, which stays; over it, the panel steps aside.
    await expect(panel(page)).toHaveCount(layoutOf(page) === "docked" ? 1 : 0);
});

test("in the medical view the moves are the model's own, credited to no answer, and the table names the genes of each «Sí»", async ({ page }) => {
    await setup(page, { threeRounds: true });
    await runToResults(page, { medical: true });
    await startQuestions(page);
    await answerAll(page, [STOOL, SITUS, SWEAT].map((q) => MEDICO_TEXT[q.hpoId].text), ["No", "No", "No sé"]);
    await send(page);

    const receipt = panel(page).locator("[data-change-receipt]");
    await expect(receipt.getByRole("listitem")).toHaveText([/SCNN1A/, /DNAH5/, /CFTR/]);
    await expect(receipt).not.toContainText(/por (Sí|No) a/);
    await expect(receipt.locator("[data-rerank-note]")).toBeVisible();

    await answerAll(page, [SINUS, OTITIS, POTASSIUM].map((q) => MEDICO_TEXT[q.hpoId].text), ["Sí", "No", "No"]);
    await send(page);
    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeFocused();
    await expect(panel(page).locator("[data-change-receipt]")).not.toContainText(/por (Sí|No) a/);

    // The answers as a table: HPO id, term, answer, note, and the genes a «Sí» is associated with.
    const rows = panel(page).locator("[data-answers] tbody tr");
    await expect(rows).toHaveCount(6);
    await expect(panel(page).locator("[data-answers] thead th").last()).toHaveText("Asociado a");
    await expect(rows.first()).toContainText(STOOL.hpoId);
    await expect(rows.first()).toContainText(STOOL.label);
    await expect(rows.first().getByRole("button")).toHaveCount(0);
    const sinus = rows.filter({ hasText: SINUS.hpoId });
    await expect(sinus.getByRole("button", { name: /Ver el gen/ })).toHaveText([/DNAH5/, /CFTR/]);
    await expect(rows.filter({ hasText: OTITIS.hpoId }).getByRole("button")).toHaveCount(0);
    await expect(panel(page).getByText(/Origen del texto:.*generaron sin IA/)).toBeVisible();
});

test("the summary recaps, and never recommends a study or a clinical step", async ({ page }) => {
    // Decided 2026-09-28: the summary says what was asked, what was answered
    // and how the list moved. Nothing about what to request, confirm or rule out.
    const advice = /estudi|test del|solicitar|pedir|confirmar|descartar|secuenci|conviene|deber[ií]a/i;
    for (const mode of ["paciente", "medico"] as const) {
        for (const kind of ["refined", "early"] as const) expect(SUMMARIES[kind][mode]).not.toMatch(advice);
    }
    await setup(page);
    await runToResults(page, { medical: true });
    await startQuestions(page);
    await answerAll(page, [STOOL, SITUS, SWEAT].map((q) => MEDICO_TEXT[q.hpoId].text));
    await send(page);
    await expect(panel(page).locator("[data-summary]")).toHaveText(SUMMARIES.refined.medico);
    await expect(panel(page).locator("[data-summary]")).not.toContainText(advice);
});

test("the summary copies as plain text, with the disclaimer word for word", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await setup(page);
    await runToResults(page);
    await startQuestions(page);
    await answerAll(page);
    await question(page, SWEAT.text).getByRole("button", { name: "Agregar un comentario" }).click();
    await question(page, SWEAT.text).getByLabel("Comentario (opcional)").fill("desde bebé");
    await send(page);
    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeVisible();
    await besideThePanel(page, () => chooseList(page, "Original"));

    await panel(page).getByRole("button", { name: "Copiar resumen" }).click();
    await expect(panel(page).getByText(/Copiamos el resumen/)).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Resumen copiado" })).toBeVisible();
    const family = await page.evaluate(() => navigator.clipboard.readText());
    expect(family).toContain("Para conversar en la consulta");
    expect(family).toContain(SUMMARIES.refined.paciente);
    expect(family).toContain(`Dijiste que sí: ${STOOL.label}.`);
    expect(family).toContain(`No sabías: ${SWEAT.label} («desde bebé»).`);
    // The model's list, not the order with the answers, which they went back from.
    expect(family).toContain("en el orden original del modelo");
    expect(family).toContain("1. CFTR · 2. DNAH5 · 3. SCNN1A");
    expect(family).not.toContain("Orden con tus respuestas");
    expect(family.endsWith(DISCLAIMER_TEXT)).toBe(true);
    expect(family).not.toMatch(/HP:\d|por (Sí|No) a|Favorece/);

    await besideThePanel(page, async () => {
        await page.getByLabel("Ver detalle médico").check();
        await chooseList(page, "Con tus respuestas");
    });
    await panel(page).getByRole("button", { name: /Copiar resumen|Resumen copiado/ }).click();
    // By HPO id; a round written for families carries no genes to credit.
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(
        `- ${STOOL.hpoId} ${STOOL.label}: Sí.\n`,
    );
    // Chosen, the order with the answers follows the model's, labelled as such.
    const medical = await page.evaluate(() => navigator.clipboard.readText());
    expect(medical.indexOf("1. CFTR · 2. DNAH5 · 3. SCNN1A")).toBeLessThan(medical.indexOf("1. CFTR · 2. SCNN1A · 3. DNAH5"));
    expect(medical).toContain(
        "Orden con tus respuestas. La lista con tus respuestas es orientativa: todavía estamos evaluando si mejora el orden.",
    );
});

test("when the clipboard is refused, the summary is left selected to copy by hand", async ({ page }) => {
    await setup(page);
    await runToResults(page);
    await startQuestions(page);
    await terminate(page);
    await page.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: () => Promise.reject(new Error("denied")) },
        });
        document.execCommand = () => false;
    });

    await panel(page).getByRole("button", { name: "Copiar resumen" }).click();
    await expect(panel(page).getByText(/No pudimos copiarlo solo/)).toBeVisible();
    const manual = panel(page).getByRole("textbox", { name: "Resumen para copiar" });
    await expect(manual).toBeFocused();
    expect(await manual.inputValue()).toContain(DISCLAIMER_TEXT);
});

test("printing prints the summary, the gene list and the disclaimer, and nothing else", async ({ page }) => {
    await setup(page);
    await runToResults(page);
    await startQuestions(page);
    await answerAll(page);
    await send(page);
    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeVisible();
    await besideThePanel(page, () => chooseList(page, "Original"));

    const elsewhere = [
        page.locator('[data-gene-card="CFTR"]'),
        page.getByRole("heading", { name: "Especialidades para consultar", includeHidden: true }),
        page.getByRole("button", { name: "Cerrar sesión", includeHidden: true }),
        page.getByRole("heading", { level: 1, includeHidden: true }),
    ];
    for (const locator of elsewhere) await expect(locator).toBeVisible();
    await expect(panel(page).locator("[data-print-genes]")).toBeHidden();

    await page.evaluate(() => {
        (window as unknown as { __printed: number }).__printed = 0;
        window.print = () => {
            (window as unknown as { __printed: number }).__printed += 1;
        };
    });
    await panel(page).getByRole("button", { name: "Imprimir" }).click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
    await page.emulateMedia({ media: "print" });

    await expect(panel(page).locator("[data-summary]")).toBeVisible();
    await expect(panel(page).locator("[data-answers]")).toBeVisible();
    await expect(panel(page).getByText(DISCLAIMER)).toBeVisible();
    const printed = panel(page).locator("[data-print-genes]");
    await expect(printed).toBeVisible();
    // The model's list, and only it: they went back from the order with the answers.
    await expect(printed).toContainText("En el orden original del modelo");
    await expect(printed.getByRole("listitem")).toHaveText([/^1\. CFTR$/, /^2\. DNAH5$/, /^3\. SCNN1A$/]);
    await expect(panel(page).locator("[data-print-adjusted]")).toHaveCount(0);
    for (const locator of elsewhere) await expect(locator).toBeHidden();
    await expect(panel(page).getByRole("button", { name: /Copiar resumen|Imprimir|Ver la lista|Ocultar/ })).toHaveCount(0);
    // Printed in full, not cut at the height the panel has on screen.
    const clipped = await panel(page).evaluate((frame) => {
        const body = frame.querySelector<HTMLElement>("[data-panel-scroll]")!;
        return getComputedStyle(frame).position === "fixed" || body.scrollHeight > body.clientHeight + 1;
    });
    expect(clipped).toBe(false);

    // Closing the dialog puts the page back.
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    for (const locator of elsewhere) await expect(locator).toBeVisible();

    // With the answers' list chosen, it prints too, after the model's and labelled.
    await besideThePanel(page, () => chooseList(page, "Con tus respuestas"));
    await panel(page).getByRole("button", { name: "Imprimir" }).click();
    await page.emulateMedia({ media: "print" });
    await expect(printed.getByRole("listitem")).toHaveText([/^1\. CFTR$/, /^2\. DNAH5$/, /^3\. SCNN1A$/]);
    const adjusted = panel(page).locator("[data-print-adjusted]");
    await expect(adjusted.getByRole("heading")).toHaveText("Orden con tus respuestas");
    await expect(adjusted).toContainText("todavía estamos evaluando si mejora el orden");
    await expect(adjusted.getByRole("listitem")).toHaveText([/^1\. CFTR$/, /^2\. SCNN1A \(↑ 3\.º → 2\.º\)$/, /^3\. DNAH5 \(↓ 2\.º → 3\.º\)$/]);
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
});

test("the line above the grid and the grid header's button both open the panel, and focus comes back to them", async ({ page }) => {
    await setup(page);
    await runToResults(page);
    await page.evaluate(() => window.scrollTo(0, 0));

    const teaser = page.locator("[data-refine-teaser]").getByRole("button", { name: "Respondé unas preguntas" });
    await expect(teaser).toHaveAttribute("aria-controls", "panel-preguntas");
    await teaser.click();
    await panelSettled(page);
    const title = panel(page).getByRole("heading", { name: "¿Querés afinar la lista?" });
    await expect(title).toBeFocused();
    await expect(title).toBeInViewport();
    await expect(panel(page).getByRole("button", { name: "Empezar las preguntas" })).toBeInViewport();
    // While the panel is out, its ways in step aside.
    await expect(page.locator("[data-panel-opener]")).toHaveCount(0);
    await hidePanel(page);
    await expect(teaser).toBeFocused();

    const header = page.locator("[data-gene-panel]").getByRole("button", { name: "Afinar con preguntas" });
    if (layoutOf(page) === "sheet") {
        // On a phone the launcher is the way in; the header's controls would stack three deep.
        await expect(header).toBeHidden();
        return;
    }
    await expect(header).toHaveAttribute("aria-expanded", "false");
    await header.click();
    await panelSettled(page);
    await expect(title).toBeFocused();
    await hidePanel(page);
    await expect(header).toBeFocused();
});

test("the launcher says where the session stands, and never opens the panel by itself", async ({ page }) => {
    await setup(page, { latencyMs: 1_500, threeRounds: true });
    await runToResults(page);
    await expect(launcher(page)).toHaveAttribute("data-question-launcher", "start");

    await askToStart(page);
    await expect(panel(page).getByRole("status")).toContainText("Eligiendo las preguntas");
    // Hidden mid-wait: the round keeps coming.
    await hidePanel(page);
    await expect(launcher(page)).toHaveAttribute("data-question-launcher", "preparing");
    await expect(launcher(page)).toHaveAccessibleName("Preparando preguntas…");

    await expect(launcher(page)).toHaveAttribute("data-question-launcher", "ready");
    await expect(launcher(page)).toHaveAccessibleName(/Preguntas listas.*Ronda 1 de 3/);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator("[data-refine-teaser]")).toContainText("Las preguntas siguen abiertas.");

    await openPanel(page);
    await expect(question(page, STOOL.text)).toBeVisible();
    await answerAll(page);
    await hidePanel(page);
    await expect(launcher(page)).toHaveAttribute("data-question-launcher", "continue");

    await openPanel(page);
    await send(page);
    await expect(panel(page).getByRole("heading", { name: "Ronda 2 de 3" })).toBeVisible();
    await terminate(page);
    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeVisible();
    await hidePanel(page);
    await expect(launcher(page)).toHaveAttribute("data-question-launcher", "finished");
    await expect(launcher(page)).toHaveAccessibleName("Ver el resumen para la consulta");
    await expect(page.locator("[data-refine-teaser]")).toContainText("Terminaste las preguntas.");
});

test("on a wide screen the panel docks beside the grid, which stays in view and reflows", async ({ page }) => {
    test.skip(layoutOf(page) !== "docked", "the docked panel is for screens from 1280 px");
    await setup(page);
    await runToResults(page);
    const grid = page.locator("[data-gene-grid]");
    const columns = () => grid.evaluate((list) => getComputedStyle(list).gridTemplateColumns.split(" ").length);
    expect(await columns()).toBe(3);

    await openPanel(page);
    await expect(page.getByRole("complementary", { name: "¿Querés afinar la lista?" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await columns()).toBe(2);
    await expect(panel(page)).toBeInViewport({ ratio: 1 });
    const aside = (await panel(page).boundingBox())!;
    const cards = (await grid.boundingBox())!;
    expect(cards.x + cards.width).toBeLessThanOrEqual(aside.x);
    // Seen together: with the list brought up under the header, the panel
    // stays pinned beside it, whole.
    await page.evaluate(() => {
        const genes = document.querySelector("[data-gene-panel]")!;
        window.scrollTo(0, genes.getBoundingClientRect().top + window.scrollY - 113);
    });
    await expect(page.locator('[data-gene-card="CFTR"]')).toBeInViewport();
    await expect(panel(page)).toBeInViewport({ ratio: 1 });

    // Not modal: the grid can be used with the panel open.
    await page.getByLabel("Ver detalle médico").check();
    await expect(panel(page)).toBeVisible();

    // Esc hides it from inside, and only from inside.
    await page.getByLabel("Ver detalle médico").focus();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeVisible();
    await panel(page).getByRole("button", { name: "Empezar las preguntas" }).focus();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(launcher(page)).toBeFocused();
    expect(await columns()).toBe(3);
});

test("on a phone the panel is a sheet, and a new round offers the updated list", async ({ page }) => {
    test.skip(layoutOf(page) !== "sheet", "the sheet is for screens under 768 px");
    await setup(page, { threeRounds: true });
    await runToResults(page);

    await openPanel(page);
    const sheet = page.getByRole("dialog", { name: "¿Querés afinar la lista?" });
    await expect(sheet).toHaveAttribute("data-variant", "sheet");
    const viewport = page.viewportSize()!;
    // Measured once it has slid all the way up.
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.y + (await sheet.boundingBox())!.height)).toBe(
        viewport.height,
    );
    const box = (await sheet.boundingBox())!;
    expect(box.width).toBe(viewport.width);
    expect(box.height / viewport.height).toBeCloseTo(0.92, 1);
    await expect(page.getByRole("button", { name: "Afinar con preguntas" })).toHaveCount(0);

    await panel(page).getByRole("button", { name: "Empezar las preguntas" }).click();
    await expect(panel(page).getByRole("heading", { name: "Ronda 1 de 3" })).toBeVisible();
    await answerAll(page, undefined, ["No", "No", "No sé"]);
    await send(page);
    await expect(panel(page).getByRole("heading", { name: "Ronda 2 de 3" })).toBeFocused();
    const updated = panel(page).locator("[data-list-updated]");
    await expect(updated).toContainText("Hay una lista con tus respuestas");
    await expect(updated).toBeInViewport();
    // Said, not done: the grid behind still shows the model's list.
    await expectList(page, "Original");

    await updated.getByRole("button", { name: "Verla" }).click();
    await expect(panel(page)).toHaveCount(0);
    const genes = page.getByRole("heading", { name: /Genes para llevar a la consulta/ });
    await expect(genes).toBeFocused();
    await expect(genes).toBeInViewport();
    await expectList(page, "Con tus respuestas");
    await expect(launcher(page)).toHaveAttribute("data-question-launcher", "continue");

    // Back in, the round is where it was, and the news has been seen.
    await openPanel(page);
    await expect(question(page, SINUS.text)).toBeVisible();
    await expect(panel(page).locator("[data-list-updated]")).toHaveCount(0);
});

test("on a phone nothing scrolls sideways and the launcher covers nothing at the foot", async ({ page }) => {
    test.skip(layoutOf(page) !== "sheet", "about phone widths");
    await page.setViewportSize({ width: 360, height: 740 });
    await setup(page);
    await runToResults(page);
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await sideways()).toBeLessThanOrEqual(0);

    // Centred at the bottom, within the safe area.
    const pill = (await launcher(page).boundingBox())!;
    expect(Math.abs(pill.x + pill.width / 2 - 180)).toBeLessThanOrEqual(1);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = (await page.getByRole("button", { name: /Atrás/ }).boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(pill.y);

    await startQuestions(page);
    expect(await sideways()).toBeLessThanOrEqual(0);
    const bodyOverflow = await panel(page)
        .locator("[data-panel-scroll]")
        .evaluate((body) => body.scrollWidth - body.clientWidth);
    expect(bodyOverflow).toBeLessThanOrEqual(0);
});

test.describe("on a tablet", () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test("the panel is a drawer over the page: modal, closed by Esc or the backdrop, focus back on the launcher", async ({ page }) => {
        await setup(page);
        await runToResults(page);

        await openPanel(page);
        const drawer = page.getByRole("dialog", { name: "¿Querés afinar la lista?" });
        await expect(drawer).toHaveAttribute("data-variant", "drawer");
        const box = (await drawer.boundingBox())!;
        expect(box.width).toBeLessThanOrEqual(440);
        expect(box.x + box.width).toBeGreaterThan(1000);
        await expect(drawer.getByRole("heading", { name: "¿Querés afinar la lista?" })).toBeFocused();
        // Modal: the page behind is out of reach, for a pointer and for a screen reader.
        await expect(page.getByRole("heading", { name: /Genes para llevar a la consulta/ })).toHaveCount(0);
        await page.keyboard.press("Tab");
        await expect(drawer.locator(":focus")).toHaveCount(1);

        await page.keyboard.press("Escape");
        await expect(panel(page)).toHaveCount(0);
        await expect(launcher(page)).toBeFocused();

        await openPanel(page);
        await page.mouse.click(40, 400);
        await expect(panel(page)).toHaveCount(0);
        await expect(launcher(page)).toBeFocused();

        // When the questions end, the drawer says the list behind it now
        // carries the answers.
        await startQuestions(page);
        await answerAll(page);
        await send(page);
        await expect(panel(page).locator("[data-list-updated]")).toContainText("La lista ya está ordenada con tus respuestas");
        await expectList(page, "Con tus respuestas");
    });
});

test("a slow round shows its own wait, not the page overlay", async ({ page }) => {
    await setup(page, { latencyMs: 1_500 });
    await runToResults(page);
    await askToStart(page);

    const status = panel(page).getByRole("status");
    await expect(status).toContainText("Eligiendo las preguntas que más ayudan a ordenar la lista");
    await expect(status).toContainText("Tu lista original sigue guardada.");
    await expect(panel(page)).toHaveAttribute("aria-busy", "true");
    await expect(panel(page).getByRole("button", { name: "Empezar las preguntas" })).toBeHidden();
    // The wait is the panel's own: nothing on the page is disabled for it.
    await expect(page.getByLabel("Ver detalle médico")).toBeEnabled();

    await expect(panel(page).getByRole("heading", { name: "Ronda 1 de 3" })).toBeVisible();
    await answer(page, STOOL.text, "Sí");
    await answer(page, SITUS.text, "No");
    await answer(page, SWEAT.text, "No");
    await send(page);

    // The round steps aside for the wait.
    await expect(status).toContainText("Eligiendo las preguntas");
    await expect(question(page, STOOL.text)).toBeHidden();
    await expect(panel(page).getByRole("button", { name: "Terminar acá" })).toBeHidden();
    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeVisible();
});

test("a long wait says it can take up to a minute and a half", async ({ page }) => {
    await setup(page, { latencyMs: 9_500 });
    await runToResults(page);
    await askToStart(page);
    await expect(panel(page).getByRole("status")).toContainText("Puede tardar hasta un minuto y medio", {
        timeout: 12_000,
    });
});

test("an unavailable agent says so calmly, offers one retry and keeps the result", async ({ page }) => {
    await setup(page, { failCode: "unavailable" });
    await runToResults(page);
    await askToStart(page);

    const alert = panel(page).getByRole("alert");
    await expect(alert).toContainText("no están disponibles en este momento");
    await expect(alert).toContainText("Tu resultado no cambió");
    await expect(alert).not.toContainText("agente");
    expect(await geneOrder(page)).toEqual(["CFTR", "DNAH5", "SCNN1A"]);
    await expect(page.getByText("Neumonología").first()).toBeVisible();
    await expect(panel(page).getByText(DISCLAIMER)).toBeVisible();
    // One way to try again, not two, and focus lands on it.
    await expect(panel(page).getByRole("button", { name: "Empezar las preguntas" })).toHaveCount(0);
    await expect(alert.getByRole("button", { name: "Probar de nuevo" })).toBeFocused();

    // Hidden, the launcher mentions it, and keeps the way back in.
    await hidePanel(page);
    await expect(launcher(page)).toHaveAccessibleName(/Afinar la lista.*Hubo un problema · tu resultado no cambió/);
});

test("the hourly limit says how long to wait, in words, and offers no retry before then", async ({ page }) => {
    await setup(page, { failCode: "rate_limited", retryAfter: "1800" });
    await runToResults(page);
    await askToStart(page);

    const alert = panel(page).getByRole("alert");
    await expect(alert).toContainText("Llegaste al límite de preguntas por ahora");
    await expect(alert).toContainText("Tu resultado no cambió");
    await expect(alert).toContainText("en 30 minutos");
    await expect(alert).not.toContainText("segundos");
    await expect(panel(page).getByRole("button", { name: /Probar de nuevo|Empezar las preguntas/ })).toHaveCount(0);
    await expect(alert).toBeFocused();
});

test("the platform-wide limit is not blamed on the reader, says when to come back and holds the retry", async ({ page }) => {
    await setup(page, { failCode: "global_limit", retryAfter: "7200" });
    await runToResults(page);
    await askToStart(page);

    const alert = panel(page).getByRole("alert");
    await expect(alert).toContainText("Diagnostic.ar llegó al máximo de preguntas por ahora.");
    await expect(alert).toContainText("Tu resultado no cambió");
    await expect(alert).toContainText("podés seguir en unas 2 horas");
    await expect(alert).not.toContainText(/Llegaste|límite/);
    await expect(panel(page).getByRole("button", { name: /Probar de nuevo|Empezar las preguntas/ })).toHaveCount(0);
    await expect(alert).toBeFocused();
    expect(await geneOrder(page)).toEqual(["CFTR", "DNAH5", "SCNN1A"]);
});

test("once the limit's wait is over, the retry comes back", async ({ page }) => {
    await setup(page, { failCode: "rate_limited", retryAfter: "2" });
    await runToResults(page);
    await askToStart(page);

    const alert = panel(page).getByRole("alert");
    await expect(alert).toContainText("podés seguir en unos segundos");
    await expect(alert.getByRole("button", { name: "Probar de nuevo" })).toHaveCount(0);
    await expect(alert.getByRole("button", { name: "Probar de nuevo" })).toBeVisible({ timeout: 5_000 });
});

test("a round already running in another tab is told apart from the limit", async ({ page }) => {
    await setup(page, { failCode: "round_in_flight", retryAfter: "10" });
    await runToResults(page);
    await askToStart(page);

    const alert = panel(page).getByRole("alert");
    await expect(alert).toContainText("Ya hay una ronda en curso en otra pestaña o ventana");
    await expect(alert).toContainText("Tu resultado no cambió");
    await expect(alert).not.toContainText("límite");
    await expect(alert.getByRole("button", { name: "Probar de nuevo" })).toBeVisible();
});

test("a failure without a code, from a proxy, is read by its status", async ({ page }) => {
    await setup(page, { failStatus: 429, retryAfter: "1800" });
    await runToResults(page);
    await askToStart(page);

    const alert = panel(page).getByRole("alert");
    await expect(alert).toContainText("Llegaste al límite de preguntas por ahora");
    await expect(alert).toContainText("en 30 minutos");
    await expect(alert.getByRole("button", { name: "Probar de nuevo" })).toHaveCount(0);
});

test("a failed send keeps the answers, and sending again is the only retry", async ({ page }) => {
    await setup(page);
    await runToResults(page);
    await startQuestions(page);
    await answerAll(page);
    await page.route("**/api/questions/rounds", (route) =>
        route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "x", code: "unavailable" }) }),
    );
    await send(page);

    const alert = panel(page).getByRole("alert");
    await expect(alert).toContainText("Tu resultado no cambió");
    await expect(panel(page).getByRole("button", { name: "Probar de nuevo" })).toHaveCount(0);
    await expect(question(page, STOOL.text).getByRole("radio", { name: "Sí" })).toBeChecked();
    await expect(sendButton(page)).toContainText("3 de 3");
    await expect(sendButton(page)).toBeFocused();

    await page.unroute("**/api/questions/rounds");
    await send(page);
    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeVisible();
});

test("a search with no usable symptoms says so and withdraws the way in", async ({ page }) => {
    await setup(page, { noUsableSymptoms: true });
    await runToResults(page);
    await askToStart(page);

    const alert = panel(page).getByRole("alert");
    await expect(alert).toContainText("No pudimos usar los síntomas de esta búsqueda para hacer preguntas.");
    await expect(alert).toContainText("Tu resultado no cambió");
    await expect(alert.getByRole("button", { name: "Probar de nuevo" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Empezar las preguntas" })).toHaveCount(0);

    await hidePanel(page);
    await expect(launcher(page)).toHaveCount(0);
    await expect(page.locator("[data-refine-teaser]")).toHaveCount(0);
    await expect(page.locator("[data-panel-opener]")).toHaveCount(0);
    expect(await geneOrder(page)).toEqual(["CFTR", "DNAH5", "SCNN1A"]);
});

test("a reply lost on the way back is recovered from the saved session, without resending", async ({ page }) => {
    await setup(page, { dropReplyTo: "answers" });
    const posts = roundPosts(page);
    await runToResults(page);
    await startQuestions(page);
    await answerAll(page);
    await send(page);

    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeVisible();
    await expect(panel(page).getByRole("alert")).toHaveCount(0);
    expect(posts.map((body) => Boolean(body.answers))).toEqual([false, true]);
    // The recovered round's order is there to choose.
    await besideThePanel(page, () => chooseList(page, "Con tus respuestas"));
    expect(await geneOrder(page)).toEqual(["CFTR", "SCNN1A", "DNAH5"]);
});

test("a session finished in another tab is shown as it ended, not resent", async ({ page }) => {
    const engine = await setup(page);
    const posts = roundPosts(page);
    await runToResults(page);
    await startQuestions(page);
    engine.round({ diagnosisId: SAVED_DIAGNOSIS_ID, mode: "paciente", finish: true });

    await answerAll(page);
    await send(page);

    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeVisible();
    await expect(panel(page).getByRole("alert")).toContainText("ya habían terminado");
    await expect(panel(page).getByRole("button", { name: "Probar de nuevo" })).toHaveCount(0);
    await expect(panel(page).getByText(SUMMARIES.early.paciente)).toBeVisible();
    expect(posts).toHaveLength(2);
});

test("an expired access token is refreshed once and the round goes through", async ({ page }) => {
    await setup(page, { expireTokens: 1 });
    const refresh = page.waitForRequest((r) => r.url().endsWith("/auth/refresh"));
    await runToResults(page);
    await askToStart(page);
    await refresh;
    await expect(panel(page).getByRole("heading", { name: "Ronda 1 de 3" })).toBeVisible();
    await expect(panel(page).getByRole("alert")).toHaveCount(0);
});

test("switching to the medical view mid-session words the next round for it", async ({ page }) => {
    await setup(page);
    const posts = roundPosts(page);
    await runToResults(page);
    await startQuestions(page);

    await besideThePanel(page, () => page.getByLabel("Ver detalle médico").check());
    // The round on screen was written for families and stays that way, saying so.
    await expect(panel(page).locator("[data-mode-note]")).toContainText("La próxima ya va a venir con el detalle médico");
    await answerAll(page);
    await send(page);

    await expect(panel(page).getByText(SUMMARIES.refined.medico)).toBeVisible();
    expect(posts.map((body) => body.mode)).toEqual(["paciente", "medico"]);

    // And back: the medical summary is not shown in the family view, nor
    // does the family view send them to the medical one to read it.
    await besideThePanel(page, () => page.getByLabel("Ver detalle médico").uncheck());
    await expect(panel(page).getByText(SUMMARIES.refined.medico)).toHaveCount(0);
    await expect(panel(page).locator("[data-summary]")).toHaveText(/El resumen se escribió para la vista médica/);
    await expect(panel(page).locator("[data-summary]")).not.toContainText("Ver detalle médico");
});

test("a round written for the medical view, seen in the family view, shows no genes or clinical text", async ({ page }) => {
    const engine = await setup(page);
    engine.round({ diagnosisId: SAVED_DIAGNOSIS_ID, mode: "medico" });
    await runToResults(page);

    // Restored, and waiting: said by the launcher, not pushed on screen.
    await expect(launcher(page)).toHaveAttribute("data-question-launcher", "continue");
    await openPanel(page);
    await expect(panel(page).getByRole("heading", { name: "Ronda 1 de 3" })).toBeVisible();
    const text = await panel(page).innerText();
    for (const gene of GENES) expect(text).not.toContain(gene);
    for (const q of [STOOL, SITUS, SWEAT]) {
        expect(text).not.toContain(MEDICO_TEXT[q.hpoId].text);
        expect(text).not.toContain(q.rationale!);
        await expect(question(page, `¿Se notó algo como «${q.label}»?`)).toBeVisible();
    }
    await expect(panel(page).locator("[data-mode-note]")).toContainText("La próxima se va a escribir para vos");

    // Answering it still works, and the family wording comes back next.
    const posts = roundPosts(page);
    await answerAll(page, [STOOL, SITUS, SWEAT].map((q) => `¿Se notó algo como «${q.label}»?`));
    await send(page);
    await expect(panel(page).getByText(SUMMARIES.refined.paciente)).toBeVisible();
    expect(posts.map((body) => body.mode)).toEqual(["paciente"]);
});

test("a session finished in the medical view, reopened in the family view, hides the clinical text", async ({ page }) => {
    const engine = await setup(page);
    engine.round({ diagnosisId: SAVED_DIAGNOSIS_ID, mode: "medico" });
    engine.round({
        diagnosisId: SAVED_DIAGNOSIS_ID,
        mode: "medico",
        answers: [STOOL, SITUS, SWEAT].map((q) => ({ hpoId: q.hpoId, answer: "si" })),
    });
    await runToResults(page);
    await openPanel(page);

    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeVisible();
    await expect(panel(page).locator("[data-summary]")).toHaveText(/El resumen se escribió para la vista médica/);
    const text = await panel(page).innerText();
    expect(text).not.toContain(SUMMARIES.refined.medico);
    for (const q of [STOOL, SITUS, SWEAT]) {
        expect(text).not.toContain(MEDICO_TEXT[q.hpoId].text);
        expect(text).not.toContain(q.rationale!);
    }
    // Genes appear only as places in the list, as the grid shows them; never
    // against an answer.
    const answers = await panel(page).locator("[data-answers]").innerText();
    for (const gene of GENES) expect(answers).not.toContain(gene);
    await expect(panel(page).locator("[data-change-receipt]")).not.toContainText(/por (Sí|No) a/);
    await expect(panel(page).locator("[data-answers]")).toContainText(SWEAT.label);
});

test("the refine entry is hidden when the feature is switched off", async ({ page }) => {
    await setup(page, { enabled: false });
    await runToResults(page);

    await expect(page.getByRole("heading", { name: "Especialidades para consultar" })).toBeVisible();
    await expect(page.locator("[data-question-panel]")).toHaveCount(0);
    await expect(launcher(page)).toHaveCount(0);
    await expect(page.locator("[data-refine-teaser]")).toHaveCount(0);
    await expect(page.locator("[data-panel-opener]")).toHaveCount(0);
});

test("the refine entry is hidden when the result could not be saved", async ({ page }) => {
    // Without a saved diagnosis there is nothing to hang a session on.
    await setup(page);
    await page.route("**/api/patients", (route) =>
        route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "x" }) }),
    );
    await runToResults(page);

    await expect(page.getByText(/No pudimos guardar este resultado en tu cuenta/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Guardar de nuevo" })).toBeVisible();
    await expect(launcher(page)).toHaveCount(0);
    await expect(page.locator("[data-panel-opener]")).toHaveCount(0);
});

test("a session already on the server is restored on load", async ({ page }) => {
    // The shape GET /api/questions/:diagnosisId returns: blank notes are null,
    // and the round that closed the session is kept, with no questions.
    const answers = [
        { hpoId: STOOL.hpoId, answer: "si", note: "desde bebé" },
        { hpoId: SITUS.hpoId, answer: "no", note: null },
        { hpoId: SWEAT.hpoId, answer: "no_se", note: null },
    ];
    await setup(page, {
        seed: {
            finished: true,
            rounds: [
                { round: 1, mode: "paciente", questions: QUESTIONS_FIXTURE.round1.questions, answers },
                { round: 2, mode: "paciente", questions: [], answers: [] },
            ],
            latest: { ...QUESTIONS_FIXTURE.round2, summary: SUMMARIES.refined.paciente },
        },
    });
    await runToResults(page);

    // The session had ended, so the page opens on the list with the answers.
    await expectList(page, "Con tus respuestas");
    expect(await geneOrder(page)).toEqual(["CFTR", "SCNN1A", "DNAH5"]);
    await expect(page.locator("[data-from-questions]")).toHaveText([`${STOOL.label} · de las preguntas↗`]);
    await expect(page.getByText(`${SITUS.label} (de las preguntas)`)).toBeVisible();
    // Restoring is not something the reader did: the panel stays away, and
    // the launcher leads to where it ended.
    await expect(panel(page)).toHaveCount(0);
    await expect(launcher(page)).toHaveAttribute("data-question-launcher", "finished");

    await openPanel(page);
    await expect(panel(page).getByRole("heading", { name: "Para conversar en la consulta" })).toBeVisible();
    await expect(panel(page).locator("[data-summary]")).toHaveText(SUMMARIES.refined.paciente);
});

test("the question panel passes the serious accessibility rules, contrast included", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setup(page, { threeRounds: true });
    await runToResults(page, { medical: true });
    expect(await seriousViolations(page, "[data-question-launcher]")).toEqual([]);
    expect(await seriousViolations(page, "[data-gene-panel]")).toEqual([]);
    await openPanel(page);
    expect(await seriousViolations(page, "[data-question-panel]")).toEqual([]);

    await panel(page).getByRole("button", { name: "Empezar las preguntas" }).click();
    await expect(panel(page).getByRole("heading", { name: "Ronda 1 de 3" })).toBeVisible();
    await answer(page, MEDICO_TEXT[STOOL.hpoId].text, "Sí");
    await send(page);
    await question(page, MEDICO_TEXT[SITUS.hpoId].text).getByRole("button", { name: "Agregar un comentario" }).click();
    expect(await seriousViolations(page, "[data-question-panel]")).toEqual([]);

    await answerAll(page, [STOOL, SITUS, SWEAT].map((q) => MEDICO_TEXT[q.hpoId].text));
    await send(page);
    await expect(panel(page).locator("[data-change-receipt]")).toBeVisible();
    await panel(page).getByRole("button", { name: "Terminar acá" }).click();
    expect(await seriousViolations(page, "[data-question-panel]")).toEqual([]);

    await panel(page).getByRole("button", { name: "Sí, terminar" }).click();
    await expect(panel(page).locator("[data-answers] table")).toBeVisible();
    expect(await seriousViolations(page, "[data-question-panel]")).toEqual([]);
    await besideThePanel(page, () => page.getByLabel("Ver detalle médico").uncheck());
    expect(await seriousViolations(page, "[data-question-panel]")).toEqual([]);

    await hidePanel(page);
    expect(await seriousViolations(page, "[data-question-launcher]")).toEqual([]);
    expect(await seriousViolations(page, "[data-gene-panel]")).toEqual([]);
});

test("questions written from templates say so to the family too", async ({ page }) => {
    // With the language model out of quota the agent falls back to templates,
    // which all read alike. Without a word about it, the family would think
    // that is how the questions are meant to be.
    await setup(page, { simpleMode: true });
    await runToResults(page);
    await startQuestions(page);

    const notice = panel(page).getByRole("status").filter({ hasText: "Preguntas en modo simple" });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Estamos recibiendo muchas consultas");
    await expect(notice).toContainText("tus respuestas se usan igual");
});

test("questions written by the model carry no simple-mode notice", async ({ page }) => {
    await setup(page);
    await runToResults(page);
    await startQuestions(page);
    await expect(panel(page).getByText("Preguntas en modo simple")).toHaveCount(0);
});
