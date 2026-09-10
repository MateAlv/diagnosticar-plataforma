#!/usr/bin/env node
/**
 * `npm run dev:mock` — the whole frontend, no backend, no database, no GPU.
 *
 * Starts mocks/server.mjs and then `next dev` with every NEXT_PUBLIC_* base URL
 * pointed at it. All three services share one port because their paths do not
 * collide, which keeps the setup to a single process to babysit.
 *
 * The env vars are injected here rather than written to .env.local so this can
 * never leak into a real run: nothing on disk changes, and a plain `npm run dev`
 * still talks to whatever your .env says.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCK_PORT = process.env.MOCK_PORT ?? "4500";
const WEB_PORT = process.env.PORT ?? "3000";
const origin = `http://localhost:${WEB_PORT}`;
const mockBase = `http://localhost:${MOCK_PORT}`;

const children = [];
let shuttingDown = false;

function run(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`\n[dev:mock] ${name} exited (${signal ?? code}); shutting down.`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("mock-api", process.execPath, ["mocks/server.mjs"], {
  MOCK_PORT,
  MOCK_ALLOWED_ORIGIN: origin,
});

// Give the mock a moment to bind so the first page load does not race it.
setTimeout(() => {
  console.log(`[dev:mock] starting Next on ${origin}, API mocked at ${mockBase}\n`);
  run("next-dev", "npx", ["next", "dev", "-p", WEB_PORT], {
    NEXT_DISABLE_TURBOPACK: "1",
    // Every service the browser calls resolves to the mock.
    NEXT_PUBLIC_API_URL: `${mockBase}/api`,
    NEXT_PUBLIC_API_BASE_URL: `${mockBase}/api`,
    NEXT_PUBLIC_HPO_API_URL: mockBase,
    NEXT_PUBLIC_GENPHENAI_URL: mockBase,
    // Server-side proxy helper, for the routes that use it.
    BACKEND_API_URL: `${mockBase}/api`,
  });
}, 400);
