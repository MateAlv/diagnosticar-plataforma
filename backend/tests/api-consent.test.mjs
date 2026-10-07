import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import crypto from 'node:crypto';
import {
    databaseAvailable, skipReason, startServer, createClient,
    seedUser, authenticateClient, deleteUser, closePool,
} from './helpers/server.mjs';

/**
 * Accepting /terminos is also the express consent Ley 25.326 asks for health
 * data (art. 7) and its processing abroad (art. 12). It is kept on the
 * account with the version of the terms it was given for.
 */

const available = await databaseAvailable();
const skip = available ? false : skipReason();
const { HEALTH_DATA_CONSENT_VERSION } = await import('../dist/services/consent.js');

let server;
const created = [];

before(async () => {
    if (!available) return;
    server = await startServer();
});

after(async () => {
    if (!available) return;
    for (const id of created) await deleteUser(id);
    await server.close();
    await closePool();
});

test('signing up records the acceptance with its version', { skip }, async () => {
    const client = createClient(server.baseUrl);
    const res = await client.post('/api/auth/signup', {
        email: `consent-${crypto.randomUUID()}@example.test`,
        password: 'correct horse battery staple',
        fullName: 'Acepta',
        termsAccepted: true,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.health_data_consent, true);
    created.push(res.json.user.id);

    const { getUserById } = await import('../dist/repositories/userRepository.js');
    const row = await getUserById(res.json.user.id);
    assert.equal(row.health_data_consent_version, HEALTH_DATA_CONSENT_VERSION);
    assert.ok(row.health_data_consent_at);
});

test('an account cannot be created without accepting the terms', { skip }, async () => {
    const client = createClient(server.baseUrl);
    const res = await client.post('/api/auth/signup', {
        email: `no-consent-${crypto.randomUUID()}@example.test`,
        password: 'correct horse battery staple',
        fullName: 'Sin casilla',
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.user, undefined);
});

test('an account without the acceptance gives it once, for the current version only', { skip }, async (t) => {
    const seeded = await seedUser({ consent: false });
    t.after(() => deleteUser(seeded.id));
    const client = authenticateClient(createClient(server.baseUrl), seeded);

    const me = await client.get('/api/auth/me');
    assert.equal(me.json.user.health_data_consent, false);

    const stale = await client.post('/api/auth/consent', { version: '2020-01-01' });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, 'terms_version_changed');

    const res = await client.post('/api/auth/consent', { version: HEALTH_DATA_CONSENT_VERSION });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.health_data_consent, true);
    assert.equal((await client.get('/api/auth/me')).json.user.health_data_consent, true);
});

test('accepting needs a session and the CSRF token', { skip }, async (t) => {
    const anon = await createClient(server.baseUrl).post('/api/auth/consent', { version: HEALTH_DATA_CONSENT_VERSION });
    assert.equal(anon.status, 401);

    const seeded = await seedUser({ consent: false });
    t.after(() => deleteUser(seeded.id));
    const client = authenticateClient(createClient(server.baseUrl), seeded);
    const forged = await client.post('/api/auth/consent', { version: HEALTH_DATA_CONSENT_VERSION }, { sendCsrf: false });
    assert.equal(forged.status, 403);
});
