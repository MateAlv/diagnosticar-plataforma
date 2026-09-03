import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * config.ts validates and freezes at import time, so each scenario needs a
 * fresh process. These are the guard rails that stop a misconfigured
 * production deploy from booting with development defaults — the deploy
 * script relies on the process exiting rather than starting up half-secure.
 */
async function loadConfig(env, { entry = 'dist/config.js' } = {}) {
    // Runs from a scratch cwd: dotenv.config() reads ./.env relative to the
    // working directory, so staying in backendRoot would leak the developer's
    // real backend/.env into every scenario and mask missing-variable failures.
    const cwd = await mkdtemp(path.join(tmpdir(), 'diagnosticar-config-'));
    const entryUrl = pathToFileURL(path.join(backendRoot, entry)).href;
    const script = `
      import * as config from ${JSON.stringify(entryUrl)};
      process.stdout.write(JSON.stringify({
        NODE_ENV: config.NODE_ENV,
        IS_PRODUCTION: config.IS_PRODUCTION,
        FRONTEND_URL: config.FRONTEND_URL,
        GOOGLE_AUTH_ENABLED: config.GOOGLE_AUTH_ENABLED,
        PORT: config.PORT,
      }));
    `;
    try {
        const { stdout } = await execFileAsync(
            process.execPath,
            ['--input-type=module', '-e', script],
            { cwd, env: { PATH: process.env.PATH, ...env } },
        );
        return { ok: true, config: JSON.parse(stdout) };
    } catch (error) {
        return { ok: false, stderr: `${error.stderr ?? ''}${error.message ?? ''}` };
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
}

const PROD_BASE = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@db:5432/diagnosticar',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    FRONTEND_URL: 'https://diagnosticar.example.org',
};

test('a fully configured production env boots', async () => {
    const result = await loadConfig(PROD_BASE);
    assert.ok(result.ok, result.stderr);
    assert.equal(result.config.IS_PRODUCTION, true);
    assert.equal(result.config.FRONTEND_URL, 'https://diagnosticar.example.org');
});

test('production refuses to start without DATABASE_URL', async () => {
    const { DATABASE_URL, ...env } = PROD_BASE;
    const result = await loadConfig(env);
    assert.equal(result.ok, false);
    assert.match(result.stderr, /DATABASE_URL/);
});

test('production refuses to start without JWT secrets', async () => {
    for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
        const env = { ...PROD_BASE };
        delete env[name];
        const result = await loadConfig(env);
        assert.equal(result.ok, false, `${name} was allowed to be missing in production`);
        assert.match(result.stderr, new RegExp(name));
    }
});

test('production refuses JWT secrets shorter than 32 characters', async () => {
    const result = await loadConfig({ ...PROD_BASE, JWT_ACCESS_SECRET: 'short-secret' });
    assert.equal(result.ok, false);
    assert.match(result.stderr, /JWT_ACCESS_SECRET.*32/s);
});

test('production refuses to start without FRONTEND_URL', async () => {
    const { FRONTEND_URL, ...env } = PROD_BASE;
    const result = await loadConfig(env);
    assert.equal(result.ok, false);
    assert.match(result.stderr, /FRONTEND_URL/);
});

test('production rejects a FRONTEND_URL that is not a valid URL', async () => {
    // A bad value here would silently empty the CSRF/CORS allow-list, so the
    // origin check is what has to refuse to load — config.ts only asserts presence.
    const result = await loadConfig(
        { ...PROD_BASE, FRONTEND_URL: 'diagnosticar.example.org' },
        { entry: 'dist/middleware/csrfMiddleware.js' },
    );
    assert.equal(result.ok, false, 'an unparseable FRONTEND_URL was accepted in production');
    assert.match(result.stderr, /FRONTEND_URL|Invalid URL/i);
});

test('a valid FRONTEND_URL loads the origin allow-list without throwing', async () => {
    const result = await loadConfig(PROD_BASE, { entry: 'dist/middleware/csrfMiddleware.js' });
    assert.ok(result.ok, result.stderr);
});

test('development falls back to localhost instead of crashing', async () => {
    const result = await loadConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/dev',
        JWT_ACCESS_SECRET: 'dev-secret-that-is-long-enough-to-pass',
        JWT_REFRESH_SECRET: 'dev-secret-that-is-also-long-enough-ok',
    });
    assert.ok(result.ok, result.stderr);
    assert.equal(result.config.FRONTEND_URL, 'http://localhost:3000');
    assert.equal(result.config.IS_PRODUCTION, false);
});

test('Google OAuth stays disabled unless both client id and secret are present', async () => {
    const onlyId = await loadConfig({ ...PROD_BASE, GOOGLE_CLIENT_ID: 'id' });
    assert.equal(onlyId.config.GOOGLE_AUTH_ENABLED, false);

    const both = await loadConfig({ ...PROD_BASE, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' });
    assert.equal(both.config.GOOGLE_AUTH_ENABLED, true);
});

test('PORT falls back to 4000, matching the Dockerfile EXPOSE and compose mapping', async () => {
    const result = await loadConfig(PROD_BASE);
    assert.equal(result.config.PORT, 4000);
});
