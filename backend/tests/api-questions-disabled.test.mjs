import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

/**
 * Without QUESTION_AGENT_URL the feature is off: the UI is told so, a round is
 * refused with 503, and nothing tries to reach an agent. Its own file because
 * config.ts fixes the URL at import time.
 */

delete process.env.QUESTION_AGENT_URL;
delete process.env.QUESTION_AGENT_TOKEN;

const {
    databaseAvailable, skipReason, startServer, createClient,
    seedUser, authenticateClient, deleteUser, closePool,
} = await import('./helpers/server.mjs');

const available = await databaseAvailable();
const skip = available ? false : skipReason();

let server;
let owner;
let client;
let diagnosisId;

before(async () => {
    if (!available) return;
    server = await startServer();
    owner = await seedUser();
    client = authenticateClient(createClient(server.baseUrl), owner);
    const created = await client.post('/api/patients', {
        nombre: 'Paciente Sin Agente',
        historiaClinica: 'Talla baja.',
        symptomsExtracted: [{ description: 'Talla baja', code: 'HP:0004322' }],
        phenotypes: [],
        genphenGenes: [],
    });
    diagnosisId = created.json.diagnosisId;
});

after(async () => {
    if (!available) return;
    await deleteUser(owner.id);
    await server.close();
    await closePool();
});

test('status reports the feature as disabled', { skip }, async () => {
    const res = await client.get('/api/questions/status');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { enabled: false });
});

test('starting a round is 503 with a coded Spanish message', { skip }, async () => {
    const res = await client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });
    assert.equal(res.status, 503);
    assert.deepEqual(res.json, {
        error: 'Las preguntas de seguimiento no están disponibles en este momento.',
        code: 'disabled',
    });
});

test('a stored session can still be read while the agent is off', { skip }, async () => {
    const res = await client.get(`/api/questions/${diagnosisId}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { session: null });
});
