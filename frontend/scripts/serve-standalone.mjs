#!/usr/bin/env node
/**
 * Serves the `output: "standalone"` build the way the Docker image does.
 *
 * `next start` does not work with standalone output (Next prints a warning and
 * behaves differently), so testing against it would test an artifact that never
 * ships. This script performs the same two copies as frontend/Dockerfile and
 * then runs server.js, so E2E exercises the real deployable.
 */
import { spawn } from "node:child_process";
import { cp, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");
const port = process.argv[2] ?? "3100";

try {
    await access(path.join(standalone, "server.js"));
} catch {
    console.error(
        "[serve-standalone] .next/standalone/server.js is missing. Run `npm run build` first.",
    );
    process.exit(1);
}

// Mirrors the COPY steps in frontend/Dockerfile.
await cp(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
await cp(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), {
    recursive: true,
});

const child = spawn(process.execPath, ["server.js"], {
    cwd: standalone,
    stdio: "inherit",
    env: { ...process.env, PORT: port, HOSTNAME: "127.0.0.1", NODE_ENV: "production" },
});

const stop = (signal) => () => {
    child.kill(signal);
    process.exit(0);
};
process.on("SIGINT", stop("SIGINT"));
process.on("SIGTERM", stop("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
