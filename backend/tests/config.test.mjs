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
        QUESTION_AGENT_ENABLED: config.QUESTION_AGENT_ENABLED,
        QUESTION_AGENT_URL: config.QUESTION_AGENT_URL ?? null,
        QUESTION_AGENT_TOKEN_SET: Boolean(config.QUESTION_AGENT_TOKEN),
        QUESTION_AGENT_TIMEOUT_MS: config.QUESTION_AGENT_TIMEOUT_MS,
        QUESTION_AGENT_ROUNDS_PER_HOUR: config.QUESTION_AGENT_ROUNDS_PER_HOUR,
        QUESTION_AGENT_GLOBAL_ROUNDS_PER_5H: config.QUESTION_AGENT_GLOBAL_ROUNDS_PER_5H,
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

test('the question agent is off unless its URL is set', async () => {
    const result = await loadConfig(PROD_BASE);
    assert.ok(result.ok, result.stderr);
    assert.equal(result.config.QUESTION_AGENT_ENABLED, false);
    assert.equal(result.config.QUESTION_AGENT_TIMEOUT_MS, 100_000);
});

test('production refuses a question agent URL without its internal token', async () => {
    const result = await loadConfig({ ...PROD_BASE, QUESTION_AGENT_URL: 'http://question-agent:8010' });
    assert.equal(result.ok, false, 'the agent was reachable without a token in production');
    assert.match(result.stderr, /QUESTION_AGENT_TOKEN/);

    const short = await loadConfig({
        ...PROD_BASE, QUESTION_AGENT_URL: 'http://question-agent:8010', QUESTION_AGENT_TOKEN: 'short',
    });
    assert.equal(short.ok, false);
    assert.match(short.stderr, /QUESTION_AGENT_TOKEN.*32/s);
});

test('a configured question agent boots, with the trailing slash dropped', async () => {
    const result = await loadConfig({
        ...PROD_BASE,
        QUESTION_AGENT_URL: 'http://question-agent:8010/',
        QUESTION_AGENT_TOKEN: 'q'.repeat(40),
        QUESTION_AGENT_TIMEOUT_MS: '45000',
    });
    assert.ok(result.ok, result.stderr);
    assert.equal(result.config.QUESTION_AGENT_ENABLED, true);
    assert.equal(result.config.QUESTION_AGENT_URL, 'http://question-agent:8010');
    assert.equal(result.config.QUESTION_AGENT_TOKEN_SET, true);
    assert.equal(result.config.QUESTION_AGENT_TIMEOUT_MS, 45_000);
});

test('development may call a local question agent without a token', async () => {
    const result = await loadConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/dev',
        JWT_ACCESS_SECRET: 'dev-secret-that-is-long-enough-to-pass',
        JWT_REFRESH_SECRET: 'dev-secret-that-is-also-long-enough-ok',
        QUESTION_AGENT_URL: 'http://localhost:8010',
    });
    assert.ok(result.ok, result.stderr);
    assert.equal(result.config.QUESTION_AGENT_ENABLED, true);
    assert.equal(result.config.QUESTION_AGENT_TOKEN_SET, false);
});

test('malformed question agent settings refuse to boot', async () => {
    for (const env of [
        { QUESTION_AGENT_URL: 'question-agent:8010' },
        { QUESTION_AGENT_URL: 'ftp://question-agent' },
        { QUESTION_AGENT_TIMEOUT_MS: 'soon' },
        { QUESTION_AGENT_ROUNDS_PER_HOUR: '0' },
    ]) {
        const result = await loadConfig({ ...PROD_BASE, QUESTION_AGENT_TOKEN: 'q'.repeat(40), ...env });
        assert.equal(result.ok, false, JSON.stringify(env));
        assert.match(result.stderr, /QUESTION_AGENT_/);
    }
});

test('the round caps default to 20 per account per hour and 50 per five hours overall', async () => {
    const defaults = await loadConfig(PROD_BASE);
    assert.ok(defaults.ok, defaults.stderr);
    assert.equal(defaults.config.QUESTION_AGENT_ROUNDS_PER_HOUR, 20);
    assert.equal(defaults.config.QUESTION_AGENT_GLOBAL_ROUNDS_PER_5H, 50);

    const set = await loadConfig({
        ...PROD_BASE, QUESTION_AGENT_ROUNDS_PER_HOUR: '5', QUESTION_AGENT_GLOBAL_ROUNDS_PER_5H: '12',
    });
    assert.ok(set.ok, set.stderr);
    assert.equal(set.config.QUESTION_AGENT_ROUNDS_PER_HOUR, 5);
    assert.equal(set.config.QUESTION_AGENT_GLOBAL_ROUNDS_PER_5H, 12);
});

test('a round cap must be a positive integer; there is no value that turns one off', async () => {
    for (const name of ['QUESTION_AGENT_ROUNDS_PER_HOUR', 'QUESTION_AGENT_GLOBAL_ROUNDS_PER_5H']) {
        for (const value of ['0', '-1', '2.5', 'unlimited']) {
            const result = await loadConfig({ ...PROD_BASE, [name]: value });
            assert.equal(result.ok, false, `${name}=${value} was accepted`);
            assert.match(result.stderr, new RegExp(`${name} must be a positive integer`));
        }
    }
});
