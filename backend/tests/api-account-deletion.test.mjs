import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import {
    databaseAvailable, skipReason, startServer, createClient,
    seedUser, authenticateClient, deleteUser, closePool,
} from './helpers/server.mjs';

/**
 * Deleting an account is the one route that removes clinical data in bulk, so
 * every test asks two questions: is everything of this account gone, and is
 * everything of every other account still there, row for row.
 */

const available = await databaseAvailable();
const skip = available ? false : skipReason();

let server;
let pool;

before(async () => {
    if (!available) return;
    server = await startServer();
    ({ pool } = await import('../dist/database/pool.js'));
});

after(async () => {
    if (!available) return;
    await server.close();
    await closePool();
});

const payload = (n) => ({
    nombre: `Paciente ${n}`,
    fechaNacimiento: '2016-05-10',
    historiaClinica: `Relato ${n}: convulsiones desde los dos años.`,
    symptomsExtracted: [{ description: 'Convulsiones', code: 'HP:0001250' }],
    phenotypes: [{ hpo_id: 'HP:0001250', label_es: 'Convulsiones', negated: false }],
    genphenGenes: [],
});

/** A signed-in account with two patients, one with a second diagnosis, and a question round. */
async function accountWithData(options) {
    const seeded = await seedUser(options);
    const client = authenticateClient(createClient(server.baseUrl), seeded);
    const first = await client.post('/api/patients', payload(1));
    assert.equal(first.status, 201, first.text);
    const second = await client.post('/api/patients', payload(2));
    assert.equal(second.status, 201, second.text);
    const again = await client.post(`/api/patients/${first.json.patient.id}/diagnoses`, payload(3));
    assert.equal(again.status, 201, again.text);
    await pool.query('INSERT INTO question_agent_rounds (user_id) VALUES ($1)', [seeded.id]);
    return { ...seeded, client, patientIds: [first.json.patient.id, second.json.patient.id] };
}

async function rowsOf(userId) {
    const { rows } = await pool.query(
        `SELECT (SELECT count(*) FROM users WHERE id = $1)::int AS users,
                (SELECT count(*) FROM patients WHERE user_id = $1)::int AS patients,
                (SELECT count(*) FROM diagnoses WHERE user_id = $1)::int AS diagnoses,
                (SELECT count(*) FROM question_agent_rounds WHERE user_id = $1)::int AS rounds`,
        [userId],
    );
    return rows[0];
}

async function totals() {
    const { rows } = await pool.query(
        `SELECT (SELECT count(*) FROM users)::int AS users,
                (SELECT count(*) FROM patients)::int AS patients,
                (SELECT count(*) FROM diagnoses)::int AS diagnoses,
                (SELECT count(*) FROM question_agent_rounds)::int AS rounds`,
    );
    return rows[0];
}

const deleteAccount = (client, confirmEmail, opts = {}) =>
    client.raw('DELETE', '/api/auth/account', { body: { confirmEmail }, ...opts });

test('deleting an account removes all of it and nothing of anyone else', { skip }, async (t) => {
    const alice = await accountWithData();
    const bob = await accountWithData();
    t.after(() => deleteUser(bob.id));

    const aliceBefore = await rowsOf(alice.id);
    assert.deepEqual(aliceBefore, { users: 1, patients: 2, diagnoses: 3, rounds: 1 });
    const bobBefore = await rowsOf(bob.id);
    const before = await totals();

    const res = await deleteAccount(alice.client, alice.email.toUpperCase());
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.json, { deleted: true });

    assert.deepEqual(await rowsOf(alice.id), { users: 0, patients: 0, diagnoses: 0, rounds: 0 });
    assert.deepEqual(await rowsOf(bob.id), bobBefore, "another account's rows changed");
    const afterwards = await totals();
    assert.deepEqual(
        afterwards,
        {
            users: before.users - 1,
            patients: before.patients - aliceBefore.patients,
            diagnoses: before.diagnoses - aliceBefore.diagnoses,
            rounds: before.rounds - aliceBefore.rounds,
        },
        'more rows were deleted than the account had',
    );

    const bobPatients = await bob.client.get('/api/patients');
    assert.equal(bobPatients.status, 200);
    assert.equal(bobPatients.json.length, 2);
    for (const id of bob.patientIds) {
        const diagnoses = await bob.client.get(`/api/patients/${id}/diagnoses`);
        assert.equal(diagnoses.status, 200);
    }
});

test('the deleted account is signed out and cannot sign back in', { skip }, async () => {
    const carol = await accountWithData();
    const res = await deleteAccount(carol.client, carol.email);
    assert.equal(res.status, 200, res.text);
    assert.equal(carol.client.jar.has('access_token'), false, 'the session cookie was not cleared');

    const stale = authenticateClient(createClient(server.baseUrl), carol);
    assert.equal((await stale.get('/api/auth/me')).status, 401);
    assert.equal((await stale.get('/api/patients')).status, 401);

    const login = await createClient(server.baseUrl).post('/api/auth/login', { email: carol.email, password: carol.password });
    assert.equal(login.status, 401);
});

test('a wrong or missing confirmation deletes nothing', { skip }, async (t) => {
    const dave = await accountWithData();
    t.after(() => deleteUser(dave.id));
    const before = await rowsOf(dave.id);

    for (const body of [{ confirmEmail: 'otra@example.test' }, { confirmEmail: '' }, {}, { confirmEmail: dave.email, extra: 1 }]) {
        const res = await dave.client.raw('DELETE', '/api/auth/account', { body });
        assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.deepEqual(await rowsOf(dave.id), before);
});

test('it needs a session and the CSRF token', { skip }, async (t) => {
    const erin = await accountWithData();
    t.after(() => deleteUser(erin.id));
    const before = await rowsOf(erin.id);

    const anon = await deleteAccount(createClient(server.baseUrl), erin.email);
    assert.equal(anon.status, 401);
    const forged = await deleteAccount(erin.client, erin.email, { sendCsrf: false });
    assert.equal(forged.status, 403);
    const crossSite = await deleteAccount(erin.client, erin.email, { headers: { Origin: 'https://evil.example' } });
    assert.equal(crossSite.status, 403);

    assert.deepEqual(await rowsOf(erin.id), before);
});

test('the last admin cannot delete their account; with another admin they can', { skip }, async (t) => {
    const { setUserRole, getUserById } = await import('../dist/repositories/userRepository.js');
    const { signAccessToken, signRefreshToken } = await import('../dist/services/authService.js');

    // Any admins already in the database would make this one not the last.
    const { rows: others } = await pool.query("SELECT id FROM users WHERE role = 'admin'");
    await pool.query("UPDATE users SET role = 'user' WHERE role = 'admin'");
    t.after(async () => {
        for (const { id } of others) await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [id]);
    });

    const promote = async (seeded) => {
        await setUserRole(seeded.id, 'admin');
        const fresh = await getUserById(seeded.id);
        return authenticateClient(createClient(server.baseUrl), {
            ...seeded,
            accessToken: signAccessToken(fresh),
            refreshToken: signRefreshToken(fresh),
        });
    };

    const frank = await seedUser();
    const frankClient = await promote(frank);
    t.after(() => deleteUser(frank.id));

    const refused = await deleteAccount(frankClient, frank.email);
    assert.equal(refused.status, 409);
    assert.equal(refused.json.code, 'last_admin');
    assert.equal((await rowsOf(frank.id)).users, 1);

    const grace = await seedUser();
    t.after(() => deleteUser(grace.id));
    await promote(grace);

    const res = await deleteAccount(frankClient, frank.email);
    assert.equal(res.status, 200, res.text);
    assert.equal((await rowsOf(frank.id)).users, 0);
});

test("an account whose patient holds another account's diagnosis is not deleted", { skip }, async (t) => {
    const heidi = await accountWithData();
    const ivan = await accountWithData();
    t.after(() => deleteUser(heidi.id));
    t.after(() => deleteUser(ivan.id));

    // Never possible through the API; built by hand to prove the guard holds.
    await pool.query(
        `INSERT INTO diagnoses (patient_id, user_id, historia_clinica) VALUES ($1, $2, 'de otra cuenta')`,
        [heidi.patientIds[0], ivan.id],
    );
    const heidiBefore = await rowsOf(heidi.id);
    const ivanBefore = await rowsOf(ivan.id);

    const res = await deleteAccount(heidi.client, heidi.email);
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'account_inconsistent');
    assert.deepEqual(await rowsOf(heidi.id), heidiBefore);
    assert.deepEqual(await rowsOf(ivan.id), ivanBefore);
});
