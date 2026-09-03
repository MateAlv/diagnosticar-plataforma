import { test, expect } from "@playwright/test";
import { mockBackend, collectPageErrors, waitForImagesDecoded } from "./fixtures/services";

/**
 * "Does it render right" — the pages a visitor sees before touching the wizard.
 * These catch the failures that a passing `next build` does not: hydration
 * mismatches, missing assets, broken Spanish encoding, and layout that
 * collapses on a phone.
 */

const PUBLIC_PAGES = ["/home", "/login", "/sign-up"];

test.beforeEach(async ({ page }) => {
    await mockBackend(page);
});

for (const path of PUBLIC_PAGES) {
    test(`${path} renders without console errors or hydration mismatches`, async ({ page }) => {
        const errors = collectPageErrors(page);
        const response = await page.goto(path, { waitUntil: "networkidle" });

        expect(response?.status(), `${path} did not return 200`).toBe(200);
        await expect(page.locator("main").first()).toBeVisible();

        const hydration = errors.filter((e) => /hydrat|did not match|Minified React error/i.test(e));
        expect(hydration, `hydration errors on ${path}`).toEqual([]);
        expect(errors, `console errors on ${path}`).toEqual([]);
    });
}

test("the landing page shows its headline and primary CTAs", async ({ page }) => {
    await page.goto("/home");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Diagnostic.ar");
    await expect(page.getByRole("link", { name: /Comenzar ahora|Ir a la App/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Crear cuenta" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Iniciar sesión" }).first()).toBeVisible();
});

test("the desktop navigation exposes every section", async ({ page }, testInfo) => {
    // The nav is `hidden md:flex`, so it is genuinely absent on phones.
    test.skip(testInfo.project.name === "mobile", "nav is desktop-only by design");
    await page.goto("/home");

    for (const item of ["Nuestra metodología", "Quiénes somos", "Ayuda", "Las EPoFs"]) {
        await expect(page.getByRole("link", { name: item })).toBeVisible();
    }
});

test("every collaborator logo is present and actually loads", async ({ page }) => {
    // A 404 on a logo still "renders" — only naturalWidth proves it decoded.
    await page.goto("/home", { waitUntil: "networkidle" });

    const row = page.locator('div:has(> img[alt="Bitgenia"])').last();
    await row.scrollIntoViewIfNeeded();

    for (const alt of ["Universidad de Buenos Aires", "IQUIBICEN", "LUCAI", "Bitgenia"]) {
        const img = row.locator(`img[alt="${alt}"]`);
        await expect(img, `${alt} logo is missing`).toBeVisible();
        await expect
            .poll(() => img.evaluate((n: HTMLImageElement) => n.complete && n.naturalWidth > 0), {
                message: `${alt} logo never decoded — check the asset path`,
                timeout: 20_000,
            })
            .toBe(true);
    }
});

test("the collaborator logos sit on one row on a desktop viewport", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "wrapping is expected and correct on phones");
    await page.goto("/home", { waitUntil: "networkidle" });

    const row = page.locator('div:has(> img[alt="Bitgenia"])').last();
    await row.scrollIntoViewIfNeeded();
    // Undecoded images still occupy their intrinsic width, which would read as
    // a spurious wrap.
    await waitForImagesDecoded(page, 'div:has(> img[alt="Bitgenia"])');

    // The logos have deliberately different heights and are vertically centred,
    // so their `top` values differ on a single row. Their centres are what line
    // up; a wrap would separate them by more than the tallest logo.
    const centres = await row.locator("img").evaluateAll((nodes) =>
        nodes.map((n) => {
            const r = n.getBoundingClientRect();
            return r.top + r.height / 2;
        }),
    );
    const spread = Math.max(...centres) - Math.min(...centres);
    expect(spread, `logos wrapped: vertical centres span ${Math.round(spread)}px`).toBeLessThan(8);
});

test("Spanish copy renders with correct accents, not mojibake", async ({ page }) => {
    // Mojibake here means a charset regression somewhere in the build or proxy.
    await page.goto("/home");
    const body = await page.locator("body").innerText();

    // Body copy, not nav labels — the nav is hidden on phones.
    expect(body).toContain("diagnóstico");
    expect(body).toContain("años");
    expect(body).toMatch(/[áéíóúñÁÉÍÓÚÑ¿¡]/);
    expect(body, "mojibake in the page text").not.toMatch(/Ã[-¿]|â€|Â[^\s]/);
});

test("the document declares UTF-8 and Spanish", async ({ page }) => {
    await page.goto("/home");
    expect(await page.locator("html").getAttribute("lang")).toMatch(/^es/);
    const charset = await page.locator("meta[charset]").getAttribute("charset");
    expect(charset?.toLowerCase()).toBe("utf-8");
});

test("the page never scrolls horizontally on a phone", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile-only check");
    await page.goto("/home", { waitUntil: "networkidle" });

    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "content overflows the viewport width").toBeLessThanOrEqual(1);
});

test("security headers are served on a real page response", async ({ page }) => {
    // next.config.ts sets these; this proves they survive the standalone build.
    const response = await page.goto("/home");
    const headers = response!.headers();

    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["x-powered-by"], "Next is advertising itself").toBeUndefined();
});

test("no secret-looking value is embedded in the client bundle", async ({ page }) => {
    // Only NEXT_PUBLIC_* should reach the browser. A JWT or SMTP secret inlined
    // at build time would be readable by every visitor.
    const scripts: string[] = [];
    page.on("response", async (res) => {
        if (res.url().endsWith(".js") && res.status() === 200) {
            scripts.push(await res.text().catch(() => ""));
        }
    });
    await page.goto("/home", { waitUntil: "networkidle" });

    const haystack = scripts.join("\n");
    for (const pattern of [/JWT_ACCESS_SECRET/, /JWT_REFRESH_SECRET/, /SMTP_PASS/, /DATABASE_URL/, /postgres(ql)?:\/\/[^"'\s]+:[^"'\s]+@/]) {
        expect(haystack, `bundle contains ${pattern}`).not.toMatch(pattern);
    }
});

test("the demo route redirects into the wizard in demo mode", async ({ page }) => {
    await page.goto("/demo");
    await page.waitForURL(/\/nuevo\?demo=1/);
    expect(page.url()).toContain("demo=1");
});
