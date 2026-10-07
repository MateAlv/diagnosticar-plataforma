import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

/**
 * The Google sign-in carries a `state` bound to the browser that started it.
 * Without it, an attacker can finish their own sign-in in a victim's browser
 * and the victim then types a child's history into the attacker's account.
 * Its own file because config.ts reads the Google credentials at import time.
 */

process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

const { startServer } = await import('./helpers/server.mjs');

let server;

before(async () => {
    const { configureGoogleAuth } = await import('../dist/services/googleAuth.js');
    assert.ok(configureGoogleAuth());
    server = await startServer();
});

after(async () => {
    await server?.close();
});

function cookieValue(res, name) {
    for (const header of res.headers.getSetCookie()) {
        const [pair] = header.split(';');
        const [key, value] = pair.split('=');
        if (key === name) return value;
    }
    return null;
}

test('starting the Google sign-in sends a state and keeps it in a cookie', async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/oauth/google`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    const location = new URL(res.headers.get('location'));
    assert.equal(location.hostname, 'accounts.google.com');
    const state = location.searchParams.get('state');
    assert.match(state ?? '', /^[0-9a-f]{64}$/);
    assert.equal(cookieValue(res, 'oauth_state'), state);
    const header = res.headers.getSetCookie().find((value) => value.startsWith('oauth_state='));
    assert.match(header, /HttpOnly/i);
});

test('a callback without the matching state is refused before reaching Google', async () => {
    const cases = [
        { query: 'code=abc&state=' + 'a'.repeat(64), cookie: null },
        { query: 'code=abc', cookie: 'b'.repeat(64) },
        { query: 'code=abc&state=' + 'a'.repeat(64), cookie: 'b'.repeat(64) },
    ];
    for (const { query, cookie } of cases) {
        const res = await fetch(`${server.baseUrl}/api/auth/oauth/google/callback?${query}`, {
            redirect: 'manual',
            headers: cookie ? { cookie: `oauth_state=${cookie}` } : {},
        });
        assert.equal(res.status, 302, query);
        assert.match(res.headers.get('location') ?? '', /\/login\?error=google_auth_failed$/, query);
        assert.equal(cookieValue(res, 'access_token'), null, 'a session was issued');
    }
});
