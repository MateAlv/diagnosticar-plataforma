import './env.mjs';
import crypto from 'node:crypto';
import { TEST_ORIGIN } from './env.mjs';

/**
 * Boots the real Express app on an ephemeral port and returns a small client
 * that speaks cookies, so tests exercise the genuine middleware chain
 * (helmet -> cors -> cookieParser -> enforceOrigin -> enforceCsrf -> routes)
 * instead of a hand-rolled mock of it.
 *
 * Integration tests need Postgres. When it is unreachable the suite skips
 * rather than fails, so `npm test` still works on a laptop with no database.
 */

let cachedUnavailableReason = null;

export async function databaseAvailable() {
    if (cachedUnavailableReason !== null) return cachedUnavailableReason === false;
    try {
        const { query } = await import('../../dist/database/pool.js');
        await query('SELECT 1');
        const { migrate } = await import('../../dist/database/pool.js');
        await migrate();
        cachedUnavailableReason = false;
        return true;
    } catch (error) {
        cachedUnavailableReason = error?.message ?? 'unknown error';
        return false;
    }
}

export function skipReason() {
    return `Postgres unavailable (${cachedUnavailableReason}). Set TEST_DATABASE_URL to run integration tests.`;
}

export async function startServer() {
    const { createApp } = await import('../../dist/app.js');
    const app = createApp();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    return {
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

/** Minimal cookie jar — enough for the httpOnly access/refresh/csrf triplet. */
export function createClient(baseUrl, { origin = TEST_ORIGIN } = {}) {
    const jar = new Map();

    function cookieHeader() {
        return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    function absorb(response) {
        const raw = response.headers.getSetCookie?.() ?? [];
        for (const line of raw) {
            const [pair] = line.split(';');
            const idx = pair.indexOf('=');
            if (idx === -1) continue;
            const name = pair.slice(0, idx).trim();
            const value = pair.slice(idx + 1).trim();
            if (value === '') jar.delete(name);
            else jar.set(name, value);
        }
        return raw;
    }

    async function request(method, path, { body, headers = {}, sendCsrf = true, sendOrigin = true } = {}) {
        const finalHeaders = { ...headers };
        if (sendOrigin && !('origin' in finalHeaders) && !('Origin' in finalHeaders)) {
            finalHeaders.Origin = origin;
        }
        if (body !== undefined && !finalHeaders['Content-Type']) {
            finalHeaders['Content-Type'] = 'application/json';
        }
        const cookies = cookieHeader();
        if (cookies) finalHeaders.Cookie = cookies;
        // Only auto-fill from the jar when the caller has not set the header
        // itself — tests that deliberately send a mismatched token rely on theirs
        // surviving.
        const hasCsrfHeader = Object.keys(finalHeaders).some((k) => k.toLowerCase() === 'x-csrf-token');
        if (sendCsrf && !hasCsrfHeader && jar.has('csrf_token')) {
            finalHeaders['X-CSRF-Token'] = jar.get('csrf_token');
        }

        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: finalHeaders,
            body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
            redirect: 'manual',
        });

        const setCookie = absorb(response);
        const text = await response.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* non-JSON body */ }

        return { status: response.status, headers: response.headers, setCookie, text, json };
    }

    return {
        jar,
        get: (path, opts) => request('GET', path, opts),
        post: (path, body, opts) => request('POST', path, { ...opts, body }),
        delete: (path, opts) => request('DELETE', path, opts),
        raw: request,
    };
}

/**
 * Seeds a verified user straight through the repository layer, with the
 * health-data consent given unless `consent: false`. Going via
 * POST /signup would burn the 5-per-hour rate-limit budget that some tests
 * need to assert on.
 */
export async function seedUser({ password = 'correct horse battery staple', consent = true } = {}) {
    const { createUser, verifyUser, getUserById, recordHealthDataConsent } = await import('../../dist/repositories/userRepository.js');
    const { HEALTH_DATA_CONSENT_VERSION } = await import('../../dist/services/consent.js');
    const { hashPassword, signAccessToken, signRefreshToken } = await import('../../dist/services/authService.js');

    const email = `test-${crypto.randomUUID()}@example.test`;
    const created = await createUser(email, await hashPassword(password), null, 'Test User', 'Test Org');
    await verifyUser(created.id);
    if (consent) await recordHealthDataConsent(created.id, HEALTH_DATA_CONSENT_VERSION);
    const user = await getUserById(created.id);

    return {
        id: user.id,
        email,
        password,
        user,
        accessToken: signAccessToken(user),
        refreshToken: signRefreshToken(user),
    };
}

/** Authenticates a client by injecting cookies directly — no /login round trip. */
export function authenticateClient(client, seeded) {
    client.jar.set('access_token', seeded.accessToken);
    client.jar.set('refresh_token', seeded.refreshToken);
    client.jar.set('csrf_token', crypto.randomBytes(16).toString('hex'));
    return client;
}

export async function deleteUser(id) {
    const { deleteUserById } = await import('../../dist/repositories/userRepository.js');
    await deleteUserById(id);
}

export async function closePool() {
    try {
        const { pool } = await import('../../dist/database/pool.js');
        await pool?.end?.();
    } catch { /* pool not exported / never opened */ }
}
