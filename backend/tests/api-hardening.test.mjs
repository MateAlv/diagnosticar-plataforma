import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import {
    databaseAvailable, skipReason, startServer, createClient,
    seedUser, authenticateClient, deleteUser, closePool,
} from './helpers/server.mjs';
import { TEST_ORIGIN } from './helpers/env.mjs';

/**
 * Request-level hardening: what happens when the caller is hostile or merely
 * broken. Every case here is something a scanner or a bored user will find in
 * production, and the app must answer with a clean status code rather than a
 * 500 carrying internals.
 */

const available = await databaseAvailable();
const skip = available ? false : skipReason();

let server;
let owner;
let client;
let patientId;

const samplePayload = (overrides = {}) => ({
    nombre: 'Paciente Hardening',
    historiaClinica: 'Texto clínico de prueba.',
    symptomsExtracted: [],
    phenotypes: [],
    genphenGenes: [],
    ...overrides,
});

before(async () => {
    if (!available) return;
    server = await startServer();
    owner = await seedUser();
    client = authenticateClient(createClient(server.baseUrl), owner);
    const created = await client.post('/api/patients', samplePayload());
    patientId = created.json.patient.id;
});

after(async () => {
    if (!available) return;
    await deleteUser(owner.id);
    await server.close();
    await closePool();
});

// --- CSRF and origin -------------------------------------------------------

test('an authenticated write without the CSRF header is rejected', { skip }, async () => {
    const res = await client.post('/api/patients', samplePayload(), { sendCsrf: false });
    assert.equal(res.status, 403);
    assert.match(res.json.error, /CSRF/i);
});

test('an authenticated write with a mismatched CSRF token is rejected', { skip }, async () => {
    const res = await client.post('/api/patients', samplePayload(), {
        headers: { 'X-CSRF-Token': 'not-the-cookie-value' },
    });
    assert.equal(res.status, 403);
});

test('a write from a foreign origin is rejected before it reaches a route', { skip }, async () => {
    const res = await client.post('/api/patients', samplePayload(), {
        headers: { Origin: 'https://evil.example' },
    });
    assert.equal(res.status, 403);
    assert.match(res.json.error, /origin/i);
});

test('a write whose only clue is a foreign referer is rejected', { skip }, async () => {
    const res = await client.raw('POST', '/api/patients', {
        body: samplePayload(),
        headers: { Referer: 'https://evil.example/attack' },
        sendOrigin: false,
    });
    assert.equal(res.status, 403);
});

test('CORS never reflects an arbitrary origin back to the browser', { skip }, async () => {
    const res = await client.get('/api/patients', { headers: { Origin: 'https://evil.example' } });
    const allowed = res.headers.get('access-control-allow-origin');
    assert.ok(
        allowed === null || allowed === TEST_ORIGIN,
        `Access-Control-Allow-Origin echoed a foreign origin: ${allowed}`,
    );
});

test('the CORS allow-list does not contain a wildcard alongside credentials', { skip }, async () => {
    const res = await client.get('/api/patients');
    assert.notEqual(res.headers.get('access-control-allow-origin'), '*');
});

// --- Response headers ------------------------------------------------------

test('helmet security headers are present on API responses', { skip }, async () => {
    const res = await client.get('/api/patients');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('x-frame-options') || res.headers.get('content-security-policy'));
    assert.ok(res.headers.get('x-dns-prefetch-control'));
});

test('the server does not advertise Express', { skip }, async () => {
    const res = await client.get('/api/patients');
    assert.equal(res.headers.get('x-powered-by'), null);
});

test('API responses are JSON, never sniffable as HTML', { skip }, async () => {
    const res = await client.get('/api/patients');
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
});

// --- Malformed input -------------------------------------------------------

test('a body over the 1MB limit is refused with 413, not a 500', { skip }, async () => {
    const huge = JSON.stringify(samplePayload({ historiaClinica: 'a'.repeat(2 * 1024 * 1024) }));
    const res = await client.post('/api/patients', huge);
    assert.equal(res.status, 413, `expected 413, got ${res.status}: ${res.text.slice(0, 200)}`);
});

test('malformed JSON is refused with 400, not a 500', { skip }, async () => {
    const res = await client.post('/api/patients', '{"nombre": "unterminated');
    assert.equal(res.status, 400);
    assert.ok(!/SyntaxError|at JSON\.parse/.test(res.text), 'a parser stack trace leaked');
});

test('a field longer than its column is refused with 400, not a database error', { skip }, async () => {
    // nombre is VARCHAR(255); without the zod max this would be a 22001 from Postgres.
    const res = await client.post('/api/patients', samplePayload({ nombre: 'N'.repeat(300) }));
    assert.equal(res.status, 400);
    assert.ok(!/value too long|character varying/i.test(res.text), 'a database error leaked');
});

test('an empty patient name is refused', { skip }, async () => {
    for (const nombre of ['', '   ', null, undefined, 123, { toString: () => 'x' }]) {
        const res = await client.post('/api/patients', samplePayload({ nombre }));
        assert.equal(res.status, 400, `nombre=${JSON.stringify(nombre)} was accepted`);
    }
});

test('wrongly typed collection fields are refused', { skip }, async () => {
    const res = await client.post('/api/patients', samplePayload({ symptomsExtracted: 'not-an-array' }));
    assert.equal(res.status, 400);
});

test('signup rejects unknown fields instead of silently ignoring them', { skip }, async () => {
    // The schema is .strict() — this stops a client from smuggling `role` or
    // `verified` into the insert if the repository ever spreads the payload.
    const anon = createClient(server.baseUrl);
    const res = await anon.post('/api/auth/signup', {
        email: 'strict@example.test',
        password: 'a-long-enough-password',
        role: 'admin',
        verified: true,
    });
    assert.equal(res.status, 400);
});

test('a __proto__ key in the body does not pollute Object.prototype', { skip }, async () => {
    await client.post('/api/patients', JSON.stringify({
        ...samplePayload(),
        __proto__: { polluted: 'yes' },
        constructor: { prototype: { polluted: 'yes' } },
    }));
    assert.equal({}.polluted, undefined, 'prototype pollution succeeded');
});

// --- Injection -------------------------------------------------------------

test('SQL metacharacters in a patient name are stored as literal text', { skip }, async () => {
    const nombre = "Robert'); DROP TABLE patients;--";
    const created = await client.post('/api/patients', samplePayload({ nombre }));
    assert.equal(created.status, 201);
    assert.equal(created.json.patient.nombre, nombre, 'the value was altered in transit');

    const { query } = await import('../dist/database/pool.js');
    const stillThere = await query("SELECT to_regclass('public.patients') AS t");
    assert.ok(stillThere.rows[0].t, 'the patients table is gone');

    await client.delete(`/api/patients/${created.json.patient.id}`);
});

test('a script payload is stored verbatim and returned as JSON, not HTML', { skip }, async () => {
    const nombre = '<script>alert(document.cookie)</script>';
    const created = await client.post('/api/patients', samplePayload({ nombre }));
    assert.equal(created.status, 201);

    const read = await client.get(`/api/patients/${created.json.patient.id}`);
    assert.equal(read.json.nombre, nombre);
    assert.match(read.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(read.headers.get('x-content-type-options'), 'nosniff');

    await client.delete(`/api/patients/${created.json.patient.id}`);
});

test('clinical free text survives a round trip with accents and unicode intact', { skip }, async () => {
    // Mojibake in a historia clínica is a data-integrity bug, not a cosmetic one.
    const historiaClinica =
        'Niña de 7 años con hipotonía, retraso madurativo y convulsiones. ' +
        'Antecedente de ictericia neonatal. Evaluación cardiológica sin particularidades. ' +
        'Español: ñ á é í ó ú ü ¿? ¡! — “comillas” · µ ½ 🧬';
    const created = await client.post('/api/patients', samplePayload({ historiaClinica }));
    const diagnosis = await client.get(`/api/patients/${created.json.patient.id}/diagnoses/${created.json.diagnosisId}`);
    assert.equal(diagnosis.json.historia_clinica, historiaClinica);
    await client.delete(`/api/patients/${created.json.patient.id}`);
});

test('a NUL byte in clinical text is stripped instead of 500ing', { skip }, async () => {
    // Clinical history gets pasted out of PDFs, OCR and hospital exports, all of
    // which emit stray NUL bytes. Postgres refuses them in text and jsonb alike,
    // so an unsanitised paste used to fail the whole save.
    const nul = String.fromCharCode(0);
    const res = await client.post('/api/patients', samplePayload({
        historiaClinica: `antes${nul}despues`,
        symptomsExtracted: [{ description: `Fatiga${nul}`, code: 'HP:0012378' }],
    }));
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${res.text.slice(0, 200)}`);

    const diagnosis = await client.get(`/api/patients/${res.json.patient.id}/diagnoses/${res.json.diagnosisId}`);
    assert.equal(diagnosis.json.historia_clinica, 'antesdespues');
    assert.ok(!diagnosis.text.includes('\\u0000'), 'a NUL byte survived into jsonb');
    assert.equal(diagnosis.json.symptoms_extracted[0].description, 'Fatiga');

    await client.delete(`/api/patients/${res.json.patient.id}`);
});

// --- Error surface ---------------------------------------------------------

test('no error response carries a stack trace or file path', { skip }, async () => {
    const probes = [
        () => client.post('/api/patients', '{'),
        () => client.get('/api/patients/not-a-uuid'),
        () => client.post('/api/patients', samplePayload({ nombre: '' })),
        () => client.get('/api/nope'),
        () => client.post('/api/auth/login', { email: 'nope', password: 'short' }),
    ];
    for (const probe of probes) {
        const res = await probe();
        assert.ok(!/\/home\/|\/app\/|node_modules|at Object\.|\.ts:\d+|\.js:\d+/.test(res.text),
            `internals leaked in a ${res.status}: ${res.text.slice(0, 300)}`);
    }
});

test('the health endpoint reports status without revealing the connection string', { skip }, async () => {
    const res = await client.get('/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { status: 'ok' });
    assert.ok(!/postgres(ql)?:\/\//.test(res.text));
});

test('encoded path traversal in an id does not read the filesystem', { skip }, async () => {
    // Percent-encoded so fetch does not normalise the segments away before sending.
    const res = await client.get('/api/patients/%2e%2e%2f%2e%2e%2fetc%2fpasswd');
    assert.ok([400, 404].includes(res.status), `got ${res.status}: ${res.text.slice(0, 200)}`);
    assert.ok(!res.text.includes('root:'), 'path traversal returned file contents');
});

test('an unknown API route 404s', { skip }, async () => {
    const res = await client.get('/api/definitely-not-a-route');
    assert.equal(res.status, 404);
});

test('login gives the same answer for an unknown user and a wrong password', { skip }, async () => {
    // Divergent responses turn the login form into an account-existence oracle.
    const anon = createClient(server.baseUrl);
    const unknown = await anon.post('/api/auth/login', {
        email: `nobody-${Date.now()}@example.test`,
        password: 'some-long-password',
    });
    const wrongPassword = await anon.post('/api/auth/login', {
        email: owner.email,
        password: 'definitely-the-wrong-password',
    });
    assert.equal(unknown.status, wrongPassword.status);
    assert.deepEqual(unknown.json, wrongPassword.json);
});
