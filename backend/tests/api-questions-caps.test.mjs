import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

/**
 * The durable caps on question-agent rounds: QUESTION_AGENT_ROUNDS_PER_HOUR
 * per account and QUESTION_AGENT_GLOBAL_ROUNDS_PER_5H for the whole
 * deployment, both counted in Postgres.
 *
 * A deployment-wide count cannot be asserted against a database that other
 * test files, running in parallel, are writing rounds to. This file therefore
 * creates a scratch database and points DATABASE_URL at it before anything
 * from dist/ is loaded, since config.ts fixes it at import time.
 */

const PER_ACCOUNT = 3;
const GLOBAL = 5;
const HOUR = 3600;
const FIVE_HOURS = 5 * HOUR;

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = new URL(process.env.DATABASE_URL);
const scratchName = `diagnosticar_caps_${process.pid}_${Date.now()}`;

async function adminQuery(sql) {
    const client = new pg.Client({ connectionString: baseUrl.toString() });
    await client.connect();
    try {
        await client.query(sql);
    } finally {
        await client.end();
    }
}

let scratchError = null;
try {
    await adminQuery(`CREATE DATABASE ${scratchName}`);
    const scratchUrl = new URL(baseUrl);
    scratchUrl.pathname = `/${scratchName}`;
    process.env.DATABASE_URL = scratchUrl.toString();
    process.env.TEST_DATABASE_URL = scratchUrl.toString();
} catch (error) {
    scratchError = error?.message ?? 'unknown error';
}

const calls = [];
let behaviour = null;

function agentReply(request) {
    const finished = request.finish || request.round > 3;
    return {
        round: request.round,
        mode: request.mode,
        status: finished ? 'finished' : 'questions',
        finish_reason: finished ? (request.finish ? 'user_finished' : 'max_rounds') : null,
        questions: finished
            ? []
            : [1, 2, 3].map((k) => {
                const id = `HP:${String(request.round * 1000 + k).padStart(7, '0')}`;
                return {
                    id: `r${request.round}-${id}`, hpo_id: id, label: `Etiqueta ${id}`, text: `¿${id}?`,
                    help: null, genes_if_yes: null, genes_if_no: null, rationale: null,
                };
            }),
        ranking: [{ gene_id: 'CFTR', gene_symbol: 'CFTR', score: 0.6, model_score: 0.41, model_rank: 1 }],
        specialties: finished ? { top_specialty: 'Pulmonology', top_specialties: ['Pulmonology'] } : null,
        confidence: 0.7,
        interpreted_answers: request.answers.map((a) => ({
            hpo_id: a.hpo_id, answer: a.answer, effective_answer: a.answer, note_summary: null,
        })),
        summary: finished ? 'Resumen.' : null,
        warnings: [],
        versions: { agent: 'test', knowledge_base: 'kb-test', llm_model: 'model-test' },
    };
}

const upstream = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
        const body = JSON.parse(raw);
        calls.push(body);
        const reply = behaviour ? behaviour(body) : { status: 200, body: agentReply(body) };
        setTimeout(() => {
            if (res.destroyed) return;
            res.writeHead(reply.status, { 'Content-Type': 'application/json', ...(reply.headers ?? {}) });
            res.end(JSON.stringify(reply.body));
        }, reply.delayMs ?? 0);
    });
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));

process.env.QUESTION_AGENT_URL = `http://127.0.0.1:${upstream.address().port}`;
process.env.QUESTION_AGENT_TOKEN = 'question-agent-internal-token-for-tests';
process.env.QUESTION_AGENT_TIMEOUT_MS = '2000';
process.env.QUESTION_AGENT_ROUNDS_PER_HOUR = String(PER_ACCOUNT);
process.env.QUESTION_AGENT_GLOBAL_ROUNDS_PER_5H = String(GLOBAL);

const {
    databaseAvailable, skipReason, startServer, createClient,
    seedUser, authenticateClient, closePool,
} = await import('./helpers/server.mjs');

const available = scratchError === null && (await databaseAvailable());
const skip = available
    ? false
    : scratchError !== null
        ? `Could not create a scratch database (${scratchError}). Set TEST_DATABASE_URL to run integration tests.`
        : skipReason();

let server;
let db;

before(async () => {
    if (!available) return;
    server = await startServer();
    ({ query: db } = await import('../dist/database/pool.js'));
});

beforeEach(async () => {
    if (!available) return;
    await db('DELETE FROM question_agent_rounds');
    calls.length = 0;
    behaviour = null;
});

after(async () => {
    upstream.closeAllConnections();
    upstream.close();
    if (available) {
        await server.close();
        await closePool();
    }
    if (scratchError === null) {
        await adminQuery(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`).catch(() => {});
    }
});

async function newAccount(baseUrlOverride) {
    const user = await seedUser();
    return { user, client: authenticateClient(createClient(baseUrlOverride ?? server.baseUrl), user) };
}

async function newDiagnosis(client, overrides = {}) {
    const res = await client.post('/api/patients', {
        nombre: 'Paciente Cupos',
        historiaClinica: 'Tos crónica y talla baja.',
        symptomsExtracted: [
            { description: 'Tos crónica', code: 'HP:0012735' },
            { description: 'Talla baja', code: 'HP:0004322' },
        ],
        phenotypes: [],
        genphenGenes: [{ gene_symbol: 'CFTR', gene_id: 'CFTR', score: 0.5 }],
        ...overrides,
    });
    assert.equal(res.status, 201, res.text);
    return res.json.diagnosisId;
}

async function startRound(client) {
    return client.post('/api/questions/rounds', { diagnosisId: await newDiagnosis(client), mode: 'paciente' });
}

async function roundsOf(userId) {
    const res = await db('SELECT count(*)::int AS n FROM question_agent_rounds WHERE user_id = $1', [userId]);
    return res.rows[0].n;
}

async function recordRoundsAgo(userId, secondsAgo) {
    for (const seconds of secondsAgo) {
        await db(
            `INSERT INTO question_agent_rounds (user_id, created_at)
             VALUES ($1, now() - make_interval(secs => $2))`,
            [userId, seconds],
        );
    }
}

async function withBehaviour(fn, run) {
    behaviour = fn;
    try {
        return await run();
    } finally {
        behaviour = null;
    }
}

const GLOBAL_LIMIT_BODY = {
    error: 'diagnostic.ar llegó al máximo de preguntas por ahora. Tu resultado no cambió; podés volver a intentarlo más tarde.',
    code: 'global_limit',
};
const RATE_LIMITED_BODY = {
    error: 'Hiciste muchas consultas seguidas. Esperá un rato y volvé a intentar.',
    code: 'rate_limited',
};

function retryAfter(res) {
    return Number(res.headers.get('retry-after'));
}

test('the global cap spans accounts: the round past it is 429 global_limit', { skip }, async () => {
    const a = await newAccount();
    const b = await newAccount();
    const c = await newAccount();

    for (let i = 0; i < PER_ACCOUNT; i += 1) {
        assert.equal((await startRound(a.client)).status, 200);
    }
    for (let i = 0; i < GLOBAL - PER_ACCOUNT; i += 1) {
        assert.equal((await startRound(b.client)).status, 200);
    }
    assert.equal(calls.length, GLOBAL);

    const refused = await startRound(c.client);
    assert.equal(refused.status, 429, refused.text);
    assert.deepEqual(refused.json, GLOBAL_LIMIT_BODY);
    const wait = retryAfter(refused);
    assert.ok(wait > FIVE_HOURS - 60 && wait <= FIVE_HOURS, `Retry-After ${wait}`);

    // Also at its own cap, but the deployment-wide one is what the reader needs to hear about.
    const both = await startRound(a.client);
    assert.equal(both.status, 429);
    assert.equal(both.json.code, 'global_limit');

    assert.equal(calls.length, GLOBAL, 'a round past the global cap reached the agent');
    assert.equal(await roundsOf(c.user.id), 0);
});

test('Retry-After is when enough of the oldest rounds leave the window', { skip }, async () => {
    const filler = await newAccount();
    const a = await newAccount();

    // One round just outside the five hours, five inside, the oldest a minute from leaving.
    await recordRoundsAgo(filler.user.id, [FIVE_HOURS + 60, FIVE_HOURS - 60, 3 * HOUR, HOUR, 600, 60]);
    const global = await startRound(a.client);
    assert.equal(global.status, 429, global.text);
    assert.equal(global.json.code, 'global_limit');
    assert.ok(retryAfter(global) >= 55 && retryAfter(global) <= 60, `Retry-After ${retryAfter(global)}`);

    await db('DELETE FROM question_agent_rounds');
    // Four rounds against a cap of three: two have to age out, so the wait is
    // set by the second oldest (50 min ago), not the oldest (55 min ago).
    await recordRoundsAgo(a.user.id, [55 * 60, 50 * 60, 40 * 60, 60]);
    const account = await startRound(a.client);
    assert.equal(account.status, 429, account.text);
    assert.deepEqual(account.json, RATE_LIMITED_BODY);
    assert.ok(retryAfter(account) >= 595 && retryAfter(account) <= 600, `Retry-After ${retryAfter(account)}`);
    assert.equal(calls.length, 0);
});

test('the per-account cap does not touch another account', { skip }, async () => {
    const a = await newAccount();
    const b = await newAccount();

    for (let i = 0; i < PER_ACCOUNT; i += 1) {
        assert.equal((await startRound(a.client)).status, 200);
    }
    const limited = await startRound(a.client);
    assert.equal(limited.status, 429, limited.text);
    assert.deepEqual(limited.json, RATE_LIMITED_BODY);
    assert.ok(retryAfter(limited) > HOUR - 60 && retryAfter(limited) <= HOUR, `Retry-After ${retryAfter(limited)}`);

    const other = await startRound(b.client);
    assert.equal(other.status, 200, 'one account at its cap throttled another');
    assert.equal(await roundsOf(a.user.id), PER_ACCOUNT);
    assert.equal(await roundsOf(b.user.id), 1);
});

test('replays, 400s, 404s and 409s spend nothing', { skip }, async () => {
    const a = await newAccount();
    const b = await newAccount();
    const diagnosisId = await newDiagnosis(a.client);

    assert.equal((await a.client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' })).status, 200);
    const pending = agentReply(calls[0]).questions.map((q) => q.hpo_id);
    const finish = {
        diagnosisId, mode: 'paciente', answers: pending.map((hpoId) => ({ hpoId, answer: 'si' })), finish: true,
    };
    assert.equal((await a.client.post('/api/questions/rounds', finish)).status, 200);
    assert.equal(await roundsOf(a.user.id), 2);

    const empty = await newDiagnosis(a.client, { symptomsExtracted: [], phenotypes: [] });
    const costless = [
        [{ diagnosisId, mode: 'paciente', finish: true }, 200],
        [{ diagnosisId, mode: 'paciente' }, 409],
        [{ diagnosisId, mode: 'enfermero' }, 400],
        [{ diagnosisId: empty, mode: 'paciente' }, 400],
        [{ diagnosisId: empty, mode: 'paciente', answers: [{ hpoId: 'HP:0000001', answer: 'si' }] }, 400],
    ];
    for (let i = 0; i < 4; i += 1) {
        for (const [body, status] of costless) {
            const res = await a.client.post('/api/questions/rounds', body);
            assert.equal(res.status, status, `${JSON.stringify(body)}: ${res.text}`);
        }
        const foreign = await b.client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });
        assert.equal(foreign.status, 404);
    }

    assert.equal(calls.length, 2);
    assert.equal(await roundsOf(a.user.id), 2);
    assert.equal(await roundsOf(b.user.id), 0);
    assert.equal((await startRound(a.client)).status, 200, 'the last round of the cap was refused');
    assert.equal((await startRound(a.client)).status, 429);
});

test('a busy agent and unknown symptoms are refunded; other agent failures are not', { skip }, async () => {
    const { user, client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);
    const post = () => client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });

    const busy = await withBehaviour(
        () => ({ status: 503, body: { error: 'busy' }, headers: { 'Retry-After': '5' } }), post);
    assert.equal(busy.status, 503);
    assert.equal(busy.json.code, 'unavailable');
    const noKnown = await withBehaviour(() => ({ status: 422, body: { error: 'no-known-hpo-ids' } }), post);
    assert.equal(noKnown.status, 400);
    assert.equal(noKnown.json.code, 'no_usable_symptoms');
    assert.equal(await roundsOf(user.id), 0, 'a round the agent refused before working was kept');

    const broken = await withBehaviour(() => ({ status: 500, body: { error: 'internal-error' } }), post);
    assert.equal(broken.status, 503);
    assert.equal(await roundsOf(user.id), 1, 'a round the agent may have worked on was refunded');
    assert.equal(calls.length, 3);
});

test('the counts survive a restart: a fresh backend process sees them', { skip }, async (t) => {
    const a = await newAccount();
    const b = await newAccount();
    for (let i = 0; i < PER_ACCOUNT; i += 1) {
        assert.equal((await startRound(a.client)).status, 200);
    }

    const appUrl = pathToFileURL(path.join(backendRoot, 'dist/app.js')).href;
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
        const { createApp } = await import(${JSON.stringify(appUrl)});
        const server = createApp().listen(0, '127.0.0.1', () => {
            process.stdout.write(server.address().port + '\\n');
        });
    `], { cwd: backendRoot, env: process.env, stdio: ['ignore', 'pipe', 'inherit'] });
    t.after(() => child.kill());
    const port = await new Promise((resolve, reject) => {
        child.once('exit', (code) => reject(new Error(`the second backend exited with ${code}`)));
        child.stdout.once('data', (chunk) => resolve(Number(String(chunk).trim())));
    });
    const fresh = `http://127.0.0.1:${port}`;

    const again = await startRound(authenticateClient(createClient(fresh), a.user));
    assert.equal(again.status, 429, 'a restarted backend forgot the account\'s rounds');
    assert.equal(again.json.code, 'rate_limited');

    const bFresh = authenticateClient(createClient(fresh), b.user);
    for (let i = 0; i < GLOBAL - PER_ACCOUNT; i += 1) {
        assert.equal((await startRound(bFresh)).status, 200);
    }
    const c = await newAccount();
    const past = await startRound(c.client);
    assert.equal(past.status, 429, 'rounds from the other process were not counted here');
    assert.equal(past.json.code, 'global_limit');
    assert.equal(calls.length, GLOBAL);
});

test('simultaneous requests for the last slot: exactly one gets it', { skip }, async () => {
    const filler = await newAccount();
    const racers = await Promise.all([1, 2, 3, 4].map(() => newAccount()));
    const diagnoses = await Promise.all(racers.map(({ client }) => newDiagnosis(client)));
    await recordRoundsAgo(filler.user.id, Array.from({ length: GLOBAL - 1 }, () => 60));

    const results = await withBehaviour(
        (request) => ({ status: 200, body: agentReply(request), delayMs: 200 }),
        () => Promise.all(racers.map(({ client }, i) =>
            client.post('/api/questions/rounds', { diagnosisId: diagnoses[i], mode: 'paciente' }))),
    );
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 429, 429, 429], results.map((r) => r.text).join('\n'));
    assert.ok(results.filter((r) => r.status === 429).every((r) => r.json.code === 'global_limit'));
    assert.equal(calls.length, 1);
});

test('the lock holds under load: concurrent charges never pass either cap', { skip }, async () => {
    const { chargeQuestionRound } = await import('../dist/repositories/questionRoundRepository.js');
    const { user } = await newAccount();

    // Every pooled connection open first, so the charges really overlap.
    await Promise.all(Array.from({ length: 10 }, () => db('SELECT pg_sleep(0.05)')));
    const charge = (limits) => Promise.all(
        Array.from({ length: 20 }, () => chargeQuestionRound(user.id, limits)));
    const charged = (results) => results.filter((r) => r.status === 'charged').length;

    const global = await charge({ perAccountPerHour: 1000, globalPer5h: 7 });
    assert.equal(charged(global), 7);
    assert.ok(global.filter((r) => r.status !== 'charged').every((r) => r.status === 'global_limit'));

    await db('DELETE FROM question_agent_rounds');
    const account = await charge({ perAccountPerHour: 4, globalPer5h: 1000 });
    assert.equal(charged(account), 4);
    assert.ok(account.filter((r) => r.status !== 'charged').every((r) => r.status === 'account_limit'));
    assert.equal(await roundsOf(user.id), 4);
});

test('cleanup drops rounds older than a week and nothing still in a window', { skip }, async () => {
    const { migrate } = await import('../dist/database/pool.js');
    const { chargeQuestionRound } = await import('../dist/repositories/questionRoundRepository.js');
    const { user } = await newAccount();
    const WEEK = 7 * 24 * HOUR;
    const ages = async () => (await db(
        `SELECT round(extract(epoch FROM now() - created_at))::int AS age
         FROM question_agent_rounds ORDER BY created_at`,
    )).rows.map((r) => r.age);

    await recordRoundsAgo(user.id, [WEEK + HOUR, WEEK - HOUR, 4 * HOUR, 600]);
    await migrate();
    const afterBoot = await ages();
    assert.equal(afterBoot.length, 3, `ages after boot: ${afterBoot}`);
    assert.ok(afterBoot.every((age) => age < WEEK));

    await recordRoundsAgo(user.id, [WEEK + 60]);
    const res = await chargeQuestionRound(user.id, { perAccountPerHour: 10, globalPer5h: 10 });
    assert.equal(res.status, 'charged');
    const afterCharge = await ages();
    assert.equal(afterCharge.length, 4, `ages after a charge: ${afterCharge}`);
    assert.ok(afterCharge.every((age) => age < WEEK));
});
