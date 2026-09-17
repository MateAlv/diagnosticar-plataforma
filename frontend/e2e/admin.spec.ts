import { test, expect } from "@playwright/test";
import { mockBackend, mockAdminApi, collectPageErrors } from "./fixtures/services";

/**
 * The backoffice reads across every user's data, so these tests care about two
 * things above all: that a non-admin sees nothing, and that what an admin does
 * see renders without leaking anything or breaking on a phone.
 */

const ADMIN = { id: "55555555-5555-4555-8555-555555555555", email: "admin@diagnosticar.ar", role: "admin" };

const STAFF = [
    {
        id: ADMIN.id,
        email: ADMIN.email,
        fullName: "Equipo Diagnostic.ar",
        organization: "FCEN-UBA",
        status: "active",
        mustChangePassword: false,
        createdAt: "2026-02-19T10:00:00Z",
        lastLoginAt: "2026-09-17T08:00:00Z",
    },
    {
        id: "66666666-6666-4666-8666-666666666666",
        email: "coordinacion@iquibicen.ar",
        fullName: "Coordinación clínica",
        organization: null,
        status: "active",
        mustChangePassword: true,
        createdAt: "2026-09-13T10:00:00Z",
        lastLoginAt: null,
    },
];

const ADMIN_PAGES = ["/admin", "/admin/uso", "/admin/equipo"];

for (const path of ADMIN_PAGES) {
    test(`${path} renders for an admin without console errors`, async ({ page }) => {
        await mockBackend(page, { user: ADMIN });
        await mockAdminApi(page, { staff: STAFF });

        const errors = collectPageErrors(page);
        const response = await page.goto(path, { waitUntil: "networkidle" });

        expect(response?.status(), `${path} did not return 200`).toBe(200);
        await expect(page.locator("main").first()).toBeVisible();

        const hydration = errors.filter((e) => /hydrat|did not match|Minified React error/i.test(e));
        expect(hydration, `hydration errors on ${path}`).toEqual([]);
        expect(errors, `console errors on ${path}`).toEqual([]);
    });
}

test("the overview shows totals and the running release", async ({ page }) => {
    await mockBackend(page, { user: ADMIN });
    await mockAdminApi(page, { staff: STAFF });
    await page.goto("/admin", { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "Resumen de la plataforma" })).toBeVisible();
    await expect(page.getByText("Consultas totales")).toBeVisible();
    // 2140 is rendered compactly.
    await expect(page.getByText("2.1k")).toBeVisible();
    // The version also appears in the header badge, so scope to the card.
    await expect(page.getByRole("main").getByText("v0.1.0")).toBeVisible();
    await expect(page.getByRole("main").getByText("production")).toBeVisible();
});

test("a non-admin is told the panel does not exist, and sees no metrics", async ({ page }) => {
    await mockBackend(page, { user: { id: "77777777-7777-4777-8777-777777777777", email: "alguien@example.ar", role: "user" } });
    await mockAdminApi(page, { isAdmin: false });

    await page.goto("/admin", { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "Panel no disponible" })).toBeVisible();
    // The numbers must not be on the page at all, not merely hidden.
    await expect(page.getByText("Consultas totales")).toHaveCount(0);
    await expect(page.getByText("2.1k")).toHaveCount(0);
});

test("an account with a pending password change is sent to change it", async ({ page }) => {
    await mockBackend(page, { user: ADMIN });
    await mockAdminApi(page, { mustChangePassword: true });

    await page.goto("/admin", { waitUntil: "networkidle" });
    await page.waitForURL("**/admin/cambiar-clave", { timeout: 10_000 });

    await expect(page.getByRole("heading", { name: "Elegí tu contraseña" })).toBeVisible();
});

test("the change-password form refuses a short or mismatched password", async ({ page }) => {
    await mockBackend(page, { user: ADMIN });
    await mockAdminApi(page, { mustChangePassword: true });
    await page.goto("/admin/cambiar-clave", { waitUntil: "networkidle" });

    const submit = page.getByRole("button", { name: /Guardar y continuar/ });
    await expect(submit).toBeDisabled();

    await page.getByLabel("Contraseña temporal").fill("temporal-abc123");
    await page.getByLabel("Nueva contraseña", { exact: true }).fill("corta");
    await page.getByLabel("Repetir nueva contraseña").fill("corta");
    await expect(submit).toBeDisabled();

    await page.getByLabel("Nueva contraseña", { exact: true }).fill("una-clave-suficientemente-larga");
    await page.getByLabel("Repetir nueva contraseña").fill("otra-cosa");
    await expect(page.getByText("No coinciden.")).toBeVisible();
    await expect(submit).toBeDisabled();

    await page.getByLabel("Repetir nueva contraseña").fill("una-clave-suficientemente-larga");
    await expect(submit).toBeEnabled();
});

test("inviting an admin shows the temporary password once", async ({ page }) => {
    await mockBackend(page, { user: ADMIN });
    await mockAdminApi(page, { staff: STAFF });
    await page.goto("/admin/equipo", { waitUntil: "networkidle" });

    await expect(page.getByText("coordinacion@iquibicen.ar")).toBeVisible();
    await expect(page.getByText("Falta cambiar la contraseña")).toBeVisible();

    await page.getByLabel("Email").fill("nuevo@example.ar");
    await page.getByRole("button", { name: "Crear acceso" }).click();

    await expect(page.getByRole("heading", { name: "Contraseña temporal" })).toBeVisible();
    await expect(page.getByText("AbCdEfGhJkLmNpQrStUv")).toBeVisible();
});

test("the backoffice never renders clinical or identifying field names", async ({ page }) => {
    await mockBackend(page, { user: ADMIN });
    await mockAdminApi(page, { staff: STAFF });

    // Database column names, not Spanish words: the privacy copy on /admin/uso
    // legitimately explains why "localidad" is never aggregated, so matching the
    // bare word would flag the explanation rather than a leak.
    const COLUMNS = ["historia_clinica", "source_ip", "user_agent", "fecha_nacimiento", "user_email_snapshot"];

    for (const path of ["/admin", "/admin/uso"]) {
        await page.goto(path, { waitUntil: "networkidle" });
        const body = (await page.locator("body").innerText()).toLowerCase();
        for (const column of COLUMNS) {
            expect(body, `${path} mentions ${column}`).not.toContain(column);
        }
    }
});

test("the dashboard fits a phone without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await mockBackend(page, { user: ADMIN });
    await mockAdminApi(page, { staff: STAFF });

    for (const path of ADMIN_PAGES) {
        await page.goto(path, { waitUntil: "networkidle" });
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        );
        expect(overflow, `${path} scrolls horizontally on a phone`).toBe(false);
    }
});
