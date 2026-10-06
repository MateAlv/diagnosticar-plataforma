import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import crypto from 'node:crypto';
import {
    databaseAvailable, skipReason, startServer, createClient,
    deleteUser, closePool,
} from './helpers/server.mjs';

/**
 * The express consent Ley 25.326 asks for health data (art. 7) and its
 * processing abroad (art. 12), given with the sign-up checkbox, is kept on
 * the account with the wording it was given for.
 */

const available = await databaseAvailable();
const skip = available ? false : skipReason();

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

test('the sign-up checkbox gives it at once', { skip }, async () => {
    const client = createClient(server.baseUrl);
    const res = await client.post('/api/auth/signup', {
        email: `consent-${crypto.randomUUID()}@example.test`,
        password: 'correct horse battery staple',
        fullName: 'Consiente',
        healthDataConsent: true,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.health_data_consent, true);
    created.push(res.json.user.id);
});

test('without the checkbox nothing is recorded', { skip }, async () => {
    const client = createClient(server.baseUrl);
    const res = await client.post('/api/auth/signup', {
        email: `no-consent-${crypto.randomUUID()}@example.test`,
        password: 'correct horse battery staple',
        fullName: 'Sin casilla',
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.health_data_consent, false);
    created.push(res.json.user.id);
});
