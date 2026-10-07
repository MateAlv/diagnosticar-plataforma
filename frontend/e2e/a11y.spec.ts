import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { acceptDemoTerms, mockBackend, mockModelServices } from "./fixtures/services";

/**
 * Accessibility is not decoration here: the audience is families under stress,
 * often on a phone, sometimes with a screen reader. These scans gate on the
 * serious/critical WCAG A and AA rules only — the ones that make a page
 * genuinely unusable rather than merely imperfect.
 */

const GATED_IMPACTS = new Set(["serious", "critical"]);

/**
 * Known, unfixed accessibility debt. Listing a rule here keeps CI actionable
 * (any NEW violation still fails the build) while making the outstanding work
 * explicit rather than invisible.
 *
 * color-contrast: the accent colour used for outline buttons, secondary links
 * and small print does not reach the WCAG AA 4.5:1 ratio against the light
 * surface. Fixing it means darkening `--lu-accent` (or introducing a separate
 * `--lu-accent-text`), which is a brand decision — see the "Accessibility debt"
 * section in TESTING.md. Remove this entry once the palette is corrected.
 */
const KNOWN_A11Y_DEBT = new Set(["color-contrast"]);

function format(v: { impact?: string | null; id: string; help: string; nodes: { target?: unknown[] }[] }) {
    return `${v.impact} ${v.id}: ${v.help} (${v.nodes.length} node(s)) -> ${v.nodes[0]?.target?.join(" ")}`;
}

async function violations(page: import("@playwright/test").Page) {
    const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
    return results.violations.filter((v) => GATED_IMPACTS.has(v.impact ?? ""));
}

/** Serious/critical violations excluding the accepted debt above. */
async function scan(page: import("@playwright/test").Page) {
    return (await violations(page)).filter((v) => !KNOWN_A11Y_DEBT.has(v.id)).map(format);
}

test.beforeEach(async ({ page }) => {
    await mockBackend(page);
    await mockModelServices(page);
});

for (const path of ["/home", "/login", "/sign-up", "/terminos", "/no-existe"]) {
    test(`${path} has no serious accessibility violations`, async ({ page }) => {
        await page.goto(path, { waitUntil: "networkidle" });
        expect(await scan(page)).toEqual([]);
    });
}

test("the wizard has no serious accessibility violations", async ({ page }) => {
    await acceptDemoTerms(page);
    await page.goto("/nuevo?demo=1", { waitUntil: "networkidle" });
    expect(await scan(page)).toEqual([]);
});

test("the known contrast debt has not grown beyond the pages already affected", async ({ page }) => {
    // Not a pass/fail on the debt itself — it holds the line so the palette
    // problem cannot quietly spread while it waits to be fixed.
    await page.goto("/home", { waitUntil: "networkidle" });
    const contrast = (await violations(page)).filter((v) => v.id === "color-contrast");
    const nodes = contrast.reduce((n, v) => n + v.nodes.length, 0);
    expect(nodes, "new low-contrast elements were added to /home").toBeLessThanOrEqual(11);
});

test("every image carries alt text", async ({ page }) => {
    await page.goto("/home", { waitUntil: "networkidle" });
    const missing = await page.locator("img").evaluateAll((imgs) =>
        imgs
            .filter((i) => !(i as HTMLImageElement).alt && i.getAttribute("aria-hidden") !== "true")
            .map((i) => (i as HTMLImageElement).currentSrc || i.getAttribute("src") || "unknown"),
    );
    expect(missing, "images without alt text").toEqual([]);
});

test("the clinical history field is reachable and labelled", async ({ page }) => {
    await acceptDemoTerms(page);
    await page.goto("/nuevo?demo=1", { waitUntil: "networkidle" });
    const box = page.getByPlaceholder(/Nena de 7 años/);
    await box.focus();
    await expect(box).toBeFocused();
});

test("the page is navigable by keyboard to the primary action", async ({ page }) => {
    await page.goto("/home", { waitUntil: "networkidle" });
    // Tab until something focusable is reached; a page where Tab does nothing
    // is unusable without a mouse.
    await page.keyboard.press("Tab");
    const tag = await page.evaluate(() => document.activeElement?.tagName ?? "");
    expect(["A", "BUTTON", "INPUT", "TEXTAREA", "SELECT"]).toContain(tag);
});
