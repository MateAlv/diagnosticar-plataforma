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

/**
 * Every patient and diagnosis not owned by `userId`, by id. Other test files
 * run against the same database at the same time and add or delete their own
 * accounts, so table totals are not comparable; individual rows are.
 */
async function rowsNotOwnedBy(userId) {
    const { rows } = await pool.query(
        `SELECT 'patient' AS kind, id, user_id FROM patients WHERE user_id <> $1
         UNION ALL
         SELECT 'diagnosis' AS kind, id, user_id FROM diagnoses WHERE user_id <> $1`,
        [userId],
    );
    return rows;
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
    const others = await rowsNotOwnedBy(alice.id);

    const res = await deleteAccount(alice.client, alice.email.toUpperCase());
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.json, { deleted: true });

    assert.deepEqual(await rowsOf(alice.id), { users: 0, patients: 0, diagnoses: 0, rounds: 0 });
    assert.deepEqual(await rowsOf(bob.id), bobBefore, "another account's rows changed");
    // A row of another account may only be gone if that whole account is
    // gone too, which another test file does on its own.
    const { rows: still } = await pool.query(
        `SELECT id FROM patients UNION ALL SELECT id FROM diagnoses`,
    );
    const present = new Set(still.map((row) => row.id));
    const { rows: liveUsers } = await pool.query('SELECT id FROM users');
    const live = new Set(liveUsers.map((row) => row.id));
    const lost = others.filter((row) => !present.has(row.id) && live.has(row.user_id));
    assert.deepEqual(lost, [], "rows of another account were deleted with this one");

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

test('the last admin cannot delete their account; with another admin they can', { skip }, async () => {
    // "Last" is about the whole database, which other test files fill with
    // admins of their own at the same time. A database of its own, in a
    // process of its own, is the only place the answer is deterministic.
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const path = await import('node:path');
    const { fileURLToPath, pathToFileURL } = await import('node:url');
    const run = promisify(execFile);

    const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const dist = (file) => pathToFileURL(path.join(backendRoot, 'dist', file)).href;
    const scratchName = `diagnosticar_lastadmin_${Date.now()}`;
    const scratchUrl = new URL(process.env.DATABASE_URL);
    scratchUrl.pathname = `/${scratchName}`;
    await pool.query(`CREATE DATABASE ${scratchName}`);

    try {
        const script = `
          const { migrate, pool } = await import(${JSON.stringify(dist('database/pool.js'))});
          const users = await import(${JSON.stringify(dist('repositories/userRepository.js'))});
          const { deleteAccount } = await import(${JSON.stringify(dist('repositories/accountRepository.js'))});
          await migrate();
          const admin = async (name) => {
            const user = await users.createUser(name + '@example.test', 'x', null, name, null);
            await users.setUserRole(user.id, 'admin');
            return user;
          };
          const frank = await admin('frank');
          const alone = await deleteAccount(frank.id);
          const grace = await admin('grace');
          const withAnother = await deleteAccount(frank.id);
          const left = await pool.query('SELECT email, role FROM users ORDER BY email');
          console.log(JSON.stringify({ alone: alone.outcome, withAnother: withAnother.outcome, left: left.rows, graceId: grace.id }));
          await pool.end();
        `;
        const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], {
            cwd: backendRoot,
            env: { ...process.env, DATABASE_URL: scratchUrl.toString(), TEST_DATABASE_URL: scratchUrl.toString() },
        });
        const result = JSON.parse(stdout.trim().split('\n').pop());
        assert.equal(result.alone, 'last_admin');
        assert.equal(result.withAnother, 'deleted');
        assert.deepEqual(result.left, [{ email: 'grace@example.test', role: 'admin' }]);
    } finally {
        await pool.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`).catch(() => {});
    }
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
