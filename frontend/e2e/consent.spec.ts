import { test, expect } from "@playwright/test";
import { mockBackend } from "./fixtures/services";
import { TERMS_VERSION } from "../src/lib/terms";

/**
 * One checkbox accepts /terminos, and accepting them is the consent Ley 25.326
 * asks for health data. Every account accepts the current version once: at
 * sign-up, or in the wizard if it never did. The account can be deleted with
 * everything it loaded.
 */

const TEST_USER = {
    id: "55555555-5555-4555-8555-555555555555",
    email: "familia@example.test",
    full_name: "Familia de Prueba",
    role: "user",
};

test("sign-up has one terms checkbox, and sends the acceptance", async ({ page }) => {
    await mockBackend(page);
    let body: Record<string, unknown> | null = null;
    await page.route("**/api/auth/signup", (route) => {
        body = route.request().postDataJSON();
        return route.fulfill({ json: { user: { ...TEST_USER, health_data_consent: true } } });
    });
    await page.goto("/sign-up", { waitUntil: "networkidle" });

    await expect(page.getByRole("checkbox")).toHaveCount(1);
    const terms = page.getByRole("checkbox", { name: /Leí y acepto los términos y condiciones/ });
    await expect(terms).toBeVisible();

    await page.getByPlaceholder("Nombre de fantasía o Apodo").fill("Familia");
    await page.getByPlaceholder("Email").fill("familia@example.test");
    await page.getByPlaceholder("Contraseña", { exact: true }).fill("correct horse battery");
    await page.getByPlaceholder("Confirmar contraseña").fill("correct horse battery");

    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByText("Para crear la cuenta, aceptá los términos y condiciones.").first()).toBeVisible();
    expect(body).toBeNull();

    await terms.check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect.poll(() => body).not.toBeNull();
    expect(body!.termsAccepted).toBe(true);
});

test("signing up with Google needs the checkbox too, and carries the accepted version", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/sign-up", { waitUntil: "networkidle" });

    const google = page.getByRole("link", { name: "Continuar con Google" });
    await expect(google).toHaveAttribute("href", new RegExp(`/auth/oauth/google\\?acepto=${TERMS_VERSION}$`));

    await google.click();
    await expect(page).toHaveURL(/\/sign-up$/);
    await expect(page.getByText("Para crear la cuenta, aceptá los términos y condiciones.")).toBeVisible();

    await page.getByRole("checkbox", { name: /Leí y acepto/ }).check();
    await expect(page.getByText("Para crear la cuenta, aceptá los términos y condiciones.")).toHaveCount(0);
});

test("an account that never accepted the terms accepts them once before loading anything", async ({ page }) => {
    await mockBackend(page, { user: { ...TEST_USER, health_data_consent: false } });
    let accepted: Record<string, unknown> | null = null;
    await page.route("**/api/auth/consent", (route) => {
        accepted = route.request().postDataJSON();
        return route.fulfill({ json: { user: { ...TEST_USER, health_data_consent: true } } });
    });
    await page.goto("/nuevo", { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "Antes de empezar" })).toBeVisible();
    await expect(page.getByLabel(/^Apodo/)).toHaveCount(0);
    const continuar = page.getByRole("button", { name: "Continuar" });
    await expect(continuar).toBeDisabled();

    await page.getByRole("checkbox", { name: /Leí y acepto/ }).check();
    await continuar.click();
    await expect.poll(() => accepted).toEqual({ version: TERMS_VERSION });
    await expect(page.getByRole("heading", { name: "Antes de empezar" })).toHaveCount(0);
    await expect(page.getByLabel(/^Apodo/)).toBeVisible();
});

test("an account that already accepted goes straight to the wizard", async ({ page }) => {
    await mockBackend(page, { user: TEST_USER });
    await page.goto("/nuevo", { waitUntil: "networkidle" });
    await expect(page.getByLabel(/^Apodo/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Antes de empezar" })).toHaveCount(0);
});

test("the demo asks too, and remembers it for the tab", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/nuevo?demo=1", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Antes de empezar" })).toBeVisible();
    await page.getByRole("checkbox", { name: /Leí y acepto/ }).check();
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByPlaceholder(/Nena de 7 años/)).toBeAttached();

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Antes de empezar" })).toHaveCount(0);
});

test("deleting the account needs the email typed, and then signs out", async ({ page }) => {
    await mockBackend(page, { user: TEST_USER });
    let body: Record<string, unknown> | null = null;
    await page.route("**/api/auth/account", (route) => {
        if (route.request().method() !== "DELETE") return route.fallback();
        body = route.request().postDataJSON();
        return route.fulfill({ json: { deleted: true } });
    });
    await page.goto("/cuenta", { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "Tu cuenta" })).toBeVisible();
    await expect(page.getByText(/No se puede deshacer/)).toBeVisible();
    const borrar = page.getByRole("button", { name: "Borrar mi cuenta y todos sus datos" });
    await expect(borrar).toBeDisabled();

    const confirm = page.getByLabel("Para confirmar, escribí tu email");
    await confirm.fill("otra@example.test");
    await expect(borrar).toBeDisabled();
    await confirm.fill("Familia@Example.test");
    await expect(borrar).toBeEnabled();
    await borrar.click();

    await expect.poll(() => body).toEqual({ confirmEmail: "Familia@Example.test" });
    await expect(page.getByRole("heading", { name: "Tu cuenta se borró" })).toBeVisible();
});

test("a refused deletion says why and deletes nothing on screen", async ({ page }) => {
    await mockBackend(page, { user: TEST_USER });
    await page.route("**/api/auth/account", (route) =>
        route.fulfill({ status: 409, json: { error: "x", code: "last_admin" } }),
    );
    await page.goto("/cuenta", { waitUntil: "networkidle" });
    await page.getByLabel("Para confirmar, escribí tu email").fill(TEST_USER.email);
    await page.getByRole("button", { name: "Borrar mi cuenta y todos sus datos" }).click();
    await expect(page.getByText("Sos la única persona administradora. Invitá a otra antes de borrar tu cuenta.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tu cuenta" })).toBeVisible();
});

test("the terms say data is kept until deleted, how to delete it, and the rest", async ({ page }) => {
    await page.goto("/terminos", { waitUntil: "networkidle" });
    const main = page.getByRole("main");
    for (const text of [
        /Responsable de los datos:\s+Grupo de Genómica Clínica/,
        /Intendente Güiraldes 2160/,
        /Al aceptar estos términos nos das tu consentimiento/,
        /Anthropic, PBC, que lo procesa\s+en\s+Estados Unidos/,
        /Guardamos todo lo que cargás hasta que lo borres/,
        /podés borrar la cuenta con todo lo que cargaste/,
        /Podés retirar tu consentimiento cuando quieras borrando tu cuenta/,
        /Registro\s+Nacional de Bases de Datos Personales/,
        /leyes de la República Argentina/,
    ]) {
        await expect(main.getByText(text).first(), String(text)).toBeVisible();
    }
    await expect(main.getByRole("link", { name: "Tu cuenta" })).toHaveAttribute("href", "/cuenta");
});
