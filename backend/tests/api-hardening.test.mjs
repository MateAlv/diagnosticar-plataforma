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

test('a clinical history over 10,000 characters is refused, as in the wizard', { skip }, async () => {
    const res = await client.post('/api/patients', samplePayload({ historiaClinica: 'a'.repeat(10_001) }));
    assert.equal(res.status, 400);
    const atLimit = await client.post('/api/patients', samplePayload({ historiaClinica: 'a'.repeat(10_000) }));
    assert.equal(atLimit.status, 201, atLimit.text);
});

test('a birth date must be a real, past date', { skip }, async () => {
    const nextYear = new Date().getUTCFullYear() + 1;
    for (const fechaNacimiento of ['2015-02-30', '03/04/2015', 'ayer', `${nextYear}-01-01`, '1850-01-01']) {
        const res = await client.post('/api/patients', samplePayload({ fechaNacimiento }));
        assert.equal(res.status, 400, `fechaNacimiento=${fechaNacimiento} was accepted`);
        assert.ok(!/invalid input syntax|date/i.test(res.text), 'a database error leaked');
    }
    for (const fechaNacimiento of ['2015-04-03', '', null]) {
        const res = await client.post('/api/patients', samplePayload({ fechaNacimiento }));
        assert.equal(res.status, 201, `fechaNacimiento=${JSON.stringify(fechaNacimiento)}: ${res.text}`);
    }
});

test('a patient name of the wrong type is refused', { skip }, async () => {
    for (const nombre of [123, { toString: () => 'x' }, ['x']]) {
        const res = await client.post('/api/patients', samplePayload({ nombre }));
        assert.equal(res.status, 400, `nombre=${JSON.stringify(nombre)} was accepted`);
    }
});

test('a patient saved without a name is numbered within its account', { skip }, async () => {
    const fresh = await seedUser();
    const own = authenticateClient(createClient(server.baseUrl), fresh);
    const names = [];
    for (const nombre of ['', '   ', null, undefined]) {
        const res = await own.post('/api/patients', samplePayload({ nombre }));
        assert.equal(res.status, 201, `nombre=${JSON.stringify(nombre)} was refused`);
        names.push(res.json.patient.nombre);
    }
    assert.deepEqual(names, ['Paciente 1', 'Paciente 2', 'Paciente 3', 'Paciente 4']);

    // A named patient does not take a number, and another account starts at 1.
    const named = await own.post('/api/patients', samplePayload({ nombre: 'Juli' }));
    assert.equal(named.json.patient.nombre, 'Juli');
    const other = await client.post('/api/patients', samplePayload({ nombre: '' }));
    assert.match(other.json.patient.nombre, /^Paciente \d+$/);
    assert.notEqual(other.json.patient.nombre, 'Paciente 5');
    await client.delete(`/api/patients/${other.json.patient.id}`);
    await deleteUser(fresh.id);
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
        termsAccepted: true,
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

test('an empty clinical history is stored empty, not as text we wrote', { skip }, async () => {
    // A sentence of ours stored here was later shown, and re-submitted, as the
    // family's own account.
    for (const historiaClinica of [undefined, '', '   ']) {
        const created = await client.post('/api/patients', samplePayload({ historiaClinica }));
        assert.equal(created.status, 201);
        const diagnosis = await client.get(
            `/api/patients/${created.json.patient.id}/diagnoses/${created.json.diagnosisId}`,
        );
        assert.equal(diagnosis.json.historia_clinica, '');
        await client.delete(`/api/patients/${created.json.patient.id}`);
    }
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
        () => client.get('/api/questions/not-a-uuid'),
        () => client.post('/api/questions/rounds', { diagnosisId: 'not-a-uuid', mode: 'paciente' }),
        () => client.post('/api/patients', samplePayload({ nombre: 123 })),
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

test('a proxy Authorization: Basic header is not mistaken for a token', { skip }, async () => {
    // Staging sits behind Traefik basic auth, so the browser sends
    // `Authorization: Basic <base64>` on every request. That header belongs to
    // the proxy and says nothing about the application user. Parsing it as a
    // bearer token turned an anonymous request into 403 "Forbidden" — a failed
    // token — when it should read as 401, no credentials at all.
    const anon = createClient(server.baseUrl);
    const res = await anon.get('/api/patients', {
        headers: { Authorization: 'Basic ZXF1aXBvOnBhc3N3b3Jk' },
    });

    assert.equal(res.status, 401, 'a Basic header must read as no credentials, not a bad token');
});

test('a search keeps no IP address or browser, and older ones lose theirs', { skip }, async () => {
    const created = await client.post('/api/patients', samplePayload(), { headers: { 'User-Agent': 'Navegador de prueba/1.0' } });
    assert.equal(created.status, 201, created.text);
    const { pool, migrate } = await import('../dist/database/pool.js');
    const { rows } = await pool.query('SELECT source_ip, user_agent FROM diagnoses WHERE id = $1', [created.json.diagnosisId]);
    assert.deepEqual(rows[0], { source_ip: null, user_agent: null });

    const listed = await client.get(`/api/patients/${created.json.patient.id}/diagnoses`);
    assert.equal(listed.status, 200);
    assert.ok(!/source_ip|user_agent/.test(listed.text), 'the API still returns the columns');

    // A row written by an older image is cleared on the next boot.
    await pool.query("UPDATE diagnoses SET source_ip = '203.0.113.9', user_agent = 'viejo' WHERE id = $1", [created.json.diagnosisId]);
    await migrate();
    const { rows: after } = await pool.query('SELECT source_ip, user_agent FROM diagnoses WHERE id = $1', [created.json.diagnosisId]);
    assert.deepEqual(after[0], { source_ip: null, user_agent: null });
});
