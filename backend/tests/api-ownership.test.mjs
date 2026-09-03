import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import crypto from 'node:crypto';
import {
    databaseAvailable, skipReason, startServer, createClient,
    seedUser, authenticateClient, deleteUser, closePool,
} from './helpers/server.mjs';

/**
 * The highest-stakes tests in the repo. Every row in `patients` and
 * `diagnoses` is clinical data about a real person, so "user A can read user
 * B's records" is the failure that actually matters. Each route that takes an
 * :id is probed with a well-formed id belonging to someone else.
 */

// Resolved at module load, not in before(): node:test treats a function passed
// to `skip` as truthy, so the flag has to be a plain value by the time the
// test options object is built.
const available = await databaseAvailable();
const skip = available ? false : skipReason();

let server;
let alice;
let bob;
let aliceClient;
let bobClient;
let alicePatientId;
let aliceDiagnosisId;

const samplePayload = () => ({
    nombre: 'Paciente de Prueba',
    fechaNacimiento: '2015-04-03',
    sexo: 'F',
    localidad: 'CABA',
    pais: 'Argentina',
    historiaClinica: 'Fatiga persistente y dolor abdominal desde hace seis meses.',
    symptomsExtracted: [{ description: 'Fatiga persistente', code: 'HP:0012378' }],
    phenotypes: [{ hpo_id: 'HP:0012378', label_es: 'Fatiga', negated: false, confidence: 0.9 }],
    genphenGenes: [{ gene_symbol: 'ABCD1', gene_id: '215', score: 0.82 }],
    genphenSpecialties: { top_specialty: 'Metabolic', top_specialties: ['Metabolic'] },
    genphenConfidence: 0.82,
});

before(async () => {
    if (!available) return;
    server = await startServer();
    alice = await seedUser();
    bob = await seedUser();
    aliceClient = authenticateClient(createClient(server.baseUrl), alice);
    bobClient = authenticateClient(createClient(server.baseUrl), bob);

    const created = await aliceClient.post('/api/patients', samplePayload());
    assert.equal(created.status, 201, `setup failed: ${created.text}`);
    alicePatientId = created.json.patient.id;
    aliceDiagnosisId = created.json.diagnosisId;
});

after(async () => {
    if (!available) return;
    await deleteUser(alice.id);
    await deleteUser(bob.id);
    await server.close();
    await closePool();
});

test('a patient is created and owned by the authenticated user', { skip }, async () => {
    const res = await aliceClient.get(`/api/patients/${alicePatientId}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.user_id, alice.id);
    assert.equal(res.json.nombre, 'Paciente de Prueba');
});

test('Bob cannot read Alice\'s patient', { skip }, async () => {
    const res = await bobClient.get(`/api/patients/${alicePatientId}`);
    assert.equal(res.status, 404, 'cross-tenant patient read was allowed');
    assert.ok(!res.text.includes('Paciente de Prueba'), 'patient name leaked in the 404 body');
});

test('Bob cannot list Alice\'s patients', { skip }, async () => {
    const res = await bobClient.get('/api/patients');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, [], 'another user\'s patients appeared in the list');
});

test('Bob cannot read Alice\'s diagnoses collection', { skip }, async () => {
    const res = await bobClient.get(`/api/patients/${alicePatientId}/diagnoses`);
    assert.equal(res.status, 404);
});

test('Bob cannot read a single diagnosis of Alice\'s', { skip }, async () => {
    const res = await bobClient.get(`/api/patients/${alicePatientId}/diagnoses/${aliceDiagnosisId}`);
    assert.equal(res.status, 404, 'cross-tenant diagnosis read was allowed');
    assert.ok(!res.text.includes('Fatiga persistente'), 'clinical data leaked in the 404 body');
});

test('Bob cannot append a diagnosis to Alice\'s patient', { skip }, async () => {
    const res = await bobClient.post(`/api/patients/${alicePatientId}/diagnoses`, {
        historiaClinica: 'Inyectado por otro usuario',
        symptomsExtracted: [],
        phenotypes: [],
        genphenGenes: [],
    });
    assert.equal(res.status, 404, 'cross-tenant write was allowed');

    const stillOwned = await aliceClient.get(`/api/patients/${alicePatientId}/diagnoses`);
    assert.equal(stillOwned.json.length, 1, 'a foreign diagnosis was written to Alice\'s patient');
});

test('Bob cannot delete Alice\'s patient', { skip }, async () => {
    const res = await bobClient.delete(`/api/patients/${alicePatientId}`);
    assert.equal(res.status, 404, 'cross-tenant delete was allowed');

    const stillThere = await aliceClient.get(`/api/patients/${alicePatientId}`);
    assert.equal(stillThere.status, 200, 'Alice\'s patient was destroyed by another user');
});

test('a diagnosis id cannot be pulled out from under a different patient id', { skip }, async () => {
    const other = await aliceClient.post('/api/patients', { ...samplePayload(), nombre: 'Segundo' });
    const otherPatientId = other.json.patient.id;
    // Alice owns both, but the diagnosis does not belong to this patient.
    const res = await aliceClient.get(`/api/patients/${otherPatientId}/diagnoses/${aliceDiagnosisId}`);
    assert.equal(res.status, 404);
    await aliceClient.delete(`/api/patients/${otherPatientId}`);
});

test('every patients route rejects an unauthenticated caller', { skip }, async () => {
    const anon = createClient(server.baseUrl);
    const routes = [
        ['get', '/api/patients'],
        ['get', `/api/patients/${alicePatientId}`],
        ['get', `/api/patients/${alicePatientId}/diagnoses`],
        ['get', `/api/patients/${alicePatientId}/diagnoses/${aliceDiagnosisId}`],
        ['delete', `/api/patients/${alicePatientId}`],
    ];
    for (const [method, path] of routes) {
        const res = await anon[method](path);
        assert.equal(res.status, 401, `${method.toUpperCase()} ${path} was reachable without a token`);
    }
    const post = await anon.post('/api/patients', samplePayload());
    assert.equal(post.status, 401, 'POST /api/patients was reachable without a token');
});

test('a forged access token is rejected', { skip }, async () => {
    const forged = createClient(server.baseUrl);
    const jwt = (await import('jsonwebtoken')).default;
    forged.jar.set('access_token', jwt.sign({ sub: alice.id, role: 'admin', tokenVersion: 0 }, 'wrong-secret'));
    forged.jar.set('csrf_token', 'x');
    const res = await forged.get('/api/patients');
    assert.equal(res.status, 403);
});

test('a token for a deleted user is rejected', { skip }, async () => {
    const ghost = await seedUser();
    const ghostClient = authenticateClient(createClient(server.baseUrl), ghost);
    assert.equal((await ghostClient.get('/api/patients')).status, 200);

    await deleteUser(ghost.id);
    const after = await ghostClient.get('/api/patients');
    assert.equal(after.status, 401, 'a deleted user\'s token still worked');
});

test('bumping token_version revokes tokens already in the wild', { skip }, async () => {
    const victim = await seedUser();
    const stolen = authenticateClient(createClient(server.baseUrl), victim);
    assert.equal((await stolen.get('/api/patients')).status, 200);

    const { updateUserTokenVersion } = await import('../dist/repositories/userRepository.js');
    await updateUserTokenVersion(victim.id);

    const after = await stolen.get('/api/patients');
    assert.equal(after.status, 403, 'revocation did not invalidate the old access token');
    await deleteUser(victim.id);
});

test('deleting a patient cascades to its diagnoses', { skip }, async () => {
    const owner = await seedUser();
    const client = authenticateClient(createClient(server.baseUrl), owner);
    const created = await client.post('/api/patients', samplePayload());
    const patientId = created.json.patient.id;

    assert.equal((await client.delete(`/api/patients/${patientId}`)).status, 204);
    assert.equal((await client.get(`/api/patients/${patientId}`)).status, 404);
    assert.equal((await client.get(`/api/patients/${patientId}/diagnoses`)).status, 404);

    const { query } = await import('../dist/database/pool.js');
    const orphans = await query('SELECT count(*)::int AS n FROM diagnoses WHERE patient_id = $1', [patientId]);
    assert.equal(orphans.rows[0].n, 0, 'diagnoses survived their patient');
    await deleteUser(owner.id);
});

test('deleting a user erases their clinical records', { skip }, async () => {
    // Right-to-erasure: Ley 25.326 art. 16. If this regresses, deleting an
    // account would leave orphaned health data in the database.
    const leaver = await seedUser();
    const client = authenticateClient(createClient(server.baseUrl), leaver);
    await client.post('/api/patients', samplePayload());

    await deleteUser(leaver.id);

    const { query } = await import('../dist/database/pool.js');
    const patients = await query('SELECT count(*)::int AS n FROM patients WHERE user_id = $1', [leaver.id]);
    const diagnoses = await query('SELECT count(*)::int AS n FROM diagnoses WHERE user_id = $1', [leaver.id]);
    assert.equal(patients.rows[0].n, 0, 'patients outlived the deleted account');
    assert.equal(diagnoses.rows[0].n, 0, 'diagnoses outlived the deleted account');
});

test('a malformed id returns 404, never a 500 with a database error', { skip }, async () => {
    // `id` goes straight into a UUID column; Postgres raises 22P02 on garbage.
    // Leaking that as a 500 both reveals the schema and breaks the client.
    const ids = ['not-a-uuid', '1', '../../etc/passwd', "' OR 1=1--", crypto.randomUUID().slice(0, 8)];
    for (const id of ids) {
        const res = await aliceClient.get(`/api/patients/${encodeURIComponent(id)}`);
        assert.equal(res.status, 404, `GET /api/patients/${id} returned ${res.status}: ${res.text}`);
        assert.ok(!/invalid input syntax|uuid|postgres/i.test(res.text), `database error leaked for id ${id}`);
    }
});

test('a well-formed but unknown uuid returns 404', { skip }, async () => {
    const res = await aliceClient.get(`/api/patients/${crypto.randomUUID()}`);
    assert.equal(res.status, 404);
});
