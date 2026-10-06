import { test, expect } from "@playwright/test";
import { mockBackend } from "./fixtures/services";

/**
 * The express consent Ley 25.326 asks for health data and for sending the
 * text abroad: a checkbox of its own at sign-up, described in /terminos.
 */

const TEST_USER = {
    id: "55555555-5555-4555-8555-555555555555",
    email: "familia@example.test",
    full_name: "Familia de Prueba",
    role: "user",
};

test("sign-up asks for the health-data consent apart from the terms, and sends it", async ({ page }) => {
    await mockBackend(page);
    let body: Record<string, unknown> | null = null;
    await page.route("**/api/auth/signup", (route) => {
        body = route.request().postDataJSON();
        return route.fulfill({ json: { user: { ...TEST_USER, health_data_consent: true } } });
    });
    await page.goto("/sign-up", { waitUntil: "networkidle" });

    const consent = page.getByRole("checkbox", { name: /Autorizo al Grupo de Genómica Clínica/ });
    await expect(consent).toBeVisible();
    await expect(page.getByText(/Anthropic, en\s+Estados Unidos/)).toBeVisible();

    await page.getByPlaceholder("Nombre de fantasía o Apodo").fill("Familia");
    await page.getByPlaceholder("Email").fill("familia@example.test");
    await page.getByPlaceholder("Contraseña", { exact: true }).fill("correct horse battery");
    await page.getByPlaceholder("Confirmar contraseña").fill("correct horse battery");
    await page.getByRole("checkbox", { name: /Leí y acepto/ }).check();

    // Both are required by the browser; the consent alone is what is missing.
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    expect(body).toBeNull();

    await consent.check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect.poll(() => body).not.toBeNull();
    expect(body!.healthDataConsent).toBe(true);
});

test("the terms name the controller, the transfer abroad, retention, the registry and the law", async ({ page }) => {
    await page.goto("/terminos", { waitUntil: "networkidle" });
    const main = page.getByRole("main");
    for (const text of [
        /Responsable de los datos:\s+Grupo de Genómica Clínica/,
        /Intendente Güiraldes 2160/,
        /datos de salud/,
        /Anthropic, PBC, que lo procesa\s+en\s+Estados Unidos/,
        /Las búsquedas se guardan por tiempo indefinido/,
        /Para borrar tus datos o tu cuenta, escribí al Grupo de Genómica Clínica/,
        /Registro\s+Nacional de Bases de Datos Personales/,
        /leyes de la República Argentina/,
    ]) {
        await expect(main.getByText(text).first(), String(text)).toBeVisible();
    }
});
