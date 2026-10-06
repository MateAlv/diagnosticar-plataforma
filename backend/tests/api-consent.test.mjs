import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import crypto from 'node:crypto';
import {
    databaseAvailable, skipReason, startServer, createClient,
    seedUser, authenticateClient, deleteUser, closePool,
} from './helpers/server.mjs';

/**
 * Health data is stored only with the express consent Ley 25.326 asks for
 * (art. 7), which also covers sending the text abroad to be processed
 * (art. 12). It is kept on the account with the wording it was given for, and
 * a search is refused without it, whoever made the account and however.
 */

const available = await databaseAvailable();
const skip = available ? false : skipReason();

let server;
let without;
let withoutClient;
const created = [];

const payload = () => ({
    nombre: 'Paciente Consentimiento',
    historiaClinica: 'Texto clínico de prueba.',
    symptomsExtracted: [{ description: 'Convulsiones', code: 'HP:0001250' }],
    phenotypes: [],
    genphenGenes: [],
});

before(async () => {
    if (!available) return;
    server = await startServer();
    without = await seedUser({ consent: false });
    withoutClient = authenticateClient(createClient(server.baseUrl), without);
});

after(async () => {
    if (!available) return;
    await deleteUser(without.id);
    for (const id of created) await deleteUser(id);
    await server.close();
    await closePool();
});

test('without consent, a search is not stored and the account says why', { skip }, async () => {
    const me = await withoutClient.get('/api/auth/me');
    assert.equal(me.json.user.health_data_consent, false);

    const res = await withoutClient.post('/api/patients', payload());
    assert.equal(res.status, 403);
    assert.equal(res.json.code, 'consent_required');
});

test('consent for a wording other than the current one is refused', { skip }, async () => {
    for (const version of ['2020-01-01', '', 'x'.repeat(40)]) {
        const res = await withoutClient.post('/api/auth/consent', { version });
        assert.notEqual(res.status, 200, `version ${JSON.stringify(version)} was accepted`);
    }
    assert.equal((await withoutClient.get('/api/auth/me')).json.user.health_data_consent, false);
});

test('consent for the current wording is recorded, and the search goes through', { skip }, async () => {
    const { HEALTH_DATA_CONSENT_VERSION } = await import('../dist/services/consent.js');
    const res = await withoutClient.post('/api/auth/consent', { version: HEALTH_DATA_CONSENT_VERSION });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.health_data_consent, true);

    const saved = await withoutClient.post('/api/patients', payload());
    assert.equal(saved.status, 201);
    await withoutClient.delete(`/api/patients/${saved.json.patient.id}`);
});

test('consent requires a session and the CSRF token', { skip }, async () => {
    const { HEALTH_DATA_CONSENT_VERSION } = await import('../dist/services/consent.js');
    const anonymous = createClient(server.baseUrl);
    assert.equal((await anonymous.post('/api/auth/consent', { version: HEALTH_DATA_CONSENT_VERSION })).status, 401);
    const noCsrf = await withoutClient.post('/api/auth/consent', { version: HEALTH_DATA_CONSENT_VERSION }, { sendCsrf: false });
    assert.equal(noCsrf.status, 403);
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
