import { test, expect } from "@playwright/test";
import { mockBackend, collectPageErrors, waitForImagesDecoded } from "./fixtures/services";

/**
 * "Does it render right" — the pages a visitor sees before touching the wizard.
 * These catch the failures that a passing `next build` does not: hydration
 * mismatches, missing assets, broken Spanish encoding, and layout that
 * collapses on a phone.
 */

const PUBLIC_PAGES = ["/home", "/login", "/sign-up", "/terminos"];

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

test("an unknown address gets our own 404 page, in Spanish", async ({ page }) => {
    const response = await page.goto("/esta-pagina-no-existe");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Volver al inicio" })).toBeVisible();
    await expect(page.getByText(/could not be found/i)).toHaveCount(0);
});

test("a failed Google sign-in is explained on the login page", async ({ page }) => {
    await page.goto("/login?error=google_auth_failed", { waitUntil: "networkidle" });
    await expect(page.getByRole("alert").filter({ hasText: "No pudimos completar el ingreso con Google" })).toBeVisible();
});

test("a wrong password says so, in Spanish", async ({ page }) => {
    await page.route("**/api/auth/login", (route) =>
        route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({ error: "Invalid credentials", code: "invalid_credentials" }),
        }),
    );
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.locator('input[type="email"]').fill("familia@example.test");
    await page.locator('input[type="password"]').first().fill("una-clave-cualquiera");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "El email o la contraseña no son correctos." })).toBeVisible();
    await expect(page.getByText("Invalid credentials")).toHaveCount(0);
});

test("a failed patient list is reported with a retry, not shown as empty", async ({ page }) => {
    await mockBackend(page, { user: { id: "66666666-6666-4666-8666-666666666666", email: "familia@example.test" } });
    let calls = 0;
    await page.route("**/api/patients", (route) => {
        calls += 1;
        return calls === 1
            ? route.fulfill({ status: 502, contentType: "text/html", body: "<html>Bad Gateway</html>" })
            : route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.goto("/diagnosticar?tab=integrantes", { waitUntil: "networkidle" });

    const alert = page.getByRole("alert").filter({ hasText: "No pudimos cargar tus búsquedas guardadas" });
    await expect(alert).toBeVisible();
    await expect(page.getByText(/Todavía no tenés/)).toHaveCount(0);
    await expect(page.getByText(/Bad Gateway/)).toHaveCount(0);

    await alert.getByRole("button", { name: "Probar de nuevo" }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.getByText(/Todavía no tenés/)).toBeVisible();
});

test("a logout the server did not confirm keeps the session and says so", async ({ page }) => {
    await mockBackend(page, { user: { id: "66666666-6666-4666-8666-666666666666", email: "familia@example.test" } });
    await page.route("**/api/auth/logout", (route) => route.abort("failed"));
    await page.goto("/diagnosticar", { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    const notice = page.getByRole("alert").filter({ hasText: "No pudimos cerrar tu sesión" });
    await expect(notice).toBeVisible({ timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe("/diagnosticar");

    await page.unroute("**/api/auth/logout");
    await page.route("**/api/auth/logout", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: '{"message":"Logged out"}' }),
    );
    await page.route("**/api/auth/me", (route) =>
        route.fulfill({ status: 401, contentType: "application/json", body: '{"code":"unauthenticated"}' }),
    );
    await notice.getByRole("button", { name: "Cerrar sesión de nuevo" }).click();
    await page.waitForURL(/\/login/);
});

test("on a phone the landing's menu reaches every section, and closes on the way", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the menu is the phone's navigation");
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/home", { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Abrir el menú" }).click();
    const menu = page.locator("#menu-movil");
    for (const item of ["Nuestra metodología", "Quiénes somos", "Ayuda", "Las EPoFs", "Crear cuenta"]) {
        await expect(menu.getByRole("link", { name: item })).toBeVisible();
    }
    await menu.getByRole("link", { name: "Ayuda" }).click();
    await expect(page).toHaveURL(/#ayuda$/);
    await expect(menu).toBeHidden();
});

test("signed in on a narrow phone, the landing's header fits and sign-out is in reach", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "phone widths");
    await mockBackend(page, { user: { id: "44444444-4444-4444-8444-444444444444", email: "una.familia.con.mail.largo@example.test", role: "admin" } });
    for (const width of [320, 360]) {
        await page.setViewportSize({ width, height: 700 });
        await page.goto("/home", { waitUntil: "networkidle" });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `sideways scroll at ${width}px`).toBeLessThanOrEqual(0);

        await page.getByRole("button", { name: "Abrir el menú" }).click();
        const signOut = page.locator("#menu-movil").getByRole("button", { name: "Cerrar sesión" });
        await expect(signOut).toBeInViewport();
        await expect(page.locator("#menu-movil").getByRole("link", { name: "Administración" })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator("#menu-movil")).toBeHidden();
    }
});
