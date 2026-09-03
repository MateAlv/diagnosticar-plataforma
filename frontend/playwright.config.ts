import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * E2E runs against a production build, not `next dev`: the deployed artifact is
 * `output: "standalone"`, and dev-only behaviour (no minification, different
 * image handling, React strict double-render) hides exactly the class of bug
 * these tests exist to catch.
 *
 * When E2E_BASE_URL is set the runner assumes the target is already up — that is
 * how the post-deploy smoke check reuses this suite against staging.
 */
export default defineConfig({
    testDir: "./e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 2 : undefined,
    reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
    timeout: 45_000,
    expect: { timeout: 10_000 },

    use: {
        baseURL,
        trace: "on-first-retry",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        // The app is Spanish-only; a different locale would change date and
        // number rendering and make assertions lie.
        locale: "es-AR",
        timezoneId: "America/Argentina/Buenos_Aires",
    },

    projects: [
        { name: "chromium", use: { ...devices["Desktop Chrome"] } },
        { name: "mobile", use: { ...devices["Pixel 7"] } },
    ],

    webServer: process.env.E2E_BASE_URL
        ? undefined
        : {
              command: `node scripts/serve-standalone.mjs ${PORT}`,
              url: `http://127.0.0.1:${PORT}/home`,
              reuseExistingServer: !process.env.CI,
              timeout: 120_000,
              stdout: "pipe",
              stderr: "pipe",
          },
});
