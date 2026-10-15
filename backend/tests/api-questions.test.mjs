import { TEST_ORIGIN } from './helpers/env.mjs';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';

/**
 * The follow-up question routes against a fake agent.
 *
 * config.ts reads the agent's URL at import time, so the fake is listening and
 * the variables are set before anything from dist/ is loaded. The timeout is
 * short so the slow-agent case finishes quickly; every other reply is instant.
 */

const INTERNAL_TOKEN = 'question-agent-internal-token-for-tests';
const LEAK = 'LEAK-MARKER /srv/agent/app.py Traceback';

const calls = [];
let behaviour = null;

function questionIds(round) {
    return [1, 2, 3].map((k) => `HP:${String(round * 1000 + k).padStart(7, '0')}`);
}

function agentReply(request) {
    const finished = request.finish || request.round > 3;
    const clinician = request.mode === 'medico';
    return {
        round: request.round,
        mode: request.mode,
        status: finished ? 'finished' : 'questions',
        finish_reason: finished ? (request.finish ? 'user_finished' : 'max_rounds') : null,
        questions: finished
            ? []
            : questionIds(request.round).map((id) => ({
                id: `r${request.round}-${id}`,
                hpo_id: id,
                label: `Etiqueta ${id}`,
                text: clinician ? `¿Presenta ${id}?` : `¿Pregunta sobre ${id}?`,
                help: null,
                genes_if_yes: clinician ? ['CFTR'] : null,
                genes_if_no: clinician ? ['DNAH5', 'CCDC39'] : null,
                rationale: clinician ? 'Separa CFTR de DNAH5.' : null,
            })),
        ranking: [
            { gene_id: 'CFTR', gene_symbol: 'CFTR', score: 0.6, model_score: 0.41, model_rank: 1 },
            { gene_id: 'DNAH5', gene_symbol: 'DNAH5', score: 0.3, model_score: 0.2, model_rank: 2 },
        ],
        specialties: finished ? { top_specialty: 'Pulmonology', top_specialties: ['Pulmonology'] } : null,
        confidence: 0.7,
        // A note is read once: an echoed reading is kept as is.
        interpreted_answers: request.answers.map((a) => ({
            hpo_id: a.hpo_id,
            answer: a.answer,
            effective_answer: a.reading?.effective_answer ?? a.answer,
            note_summary: a.reading ? a.reading.note_summary : (a.note ? `Leído: ${a.note}` : null),
        })),
        summary: finished ? 'Resumen para llevar a la consulta.' : null,
        warnings: [],
        versions: { agent: 'test', knowledge_base: 'kb-test', llm_model: 'model-test' },
    };
}

const upstream = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
        const body = JSON.parse(raw);
        calls.push({ url: req.url, headers: req.headers, body });
        const reply = behaviour ? behaviour(body) : { status: 200, body: agentReply(body) };
        if (reply.destroy) {
            req.socket.destroy();
            return;
        }
        setTimeout(() => {
            if (res.destroyed) return;
            res.writeHead(reply.status, { 'Content-Type': 'application/json', ...(reply.headers ?? {}) });
            res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
        }, reply.delayMs ?? 0);
    });
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));

process.env.QUESTION_AGENT_URL = `http://127.0.0.1:${upstream.address().port}`;
process.env.QUESTION_AGENT_TOKEN = INTERNAL_TOKEN;
process.env.QUESTION_AGENT_TIMEOUT_MS = '1000';
process.env.QUESTION_AGENT_ROUNDS_PER_HOUR = '8';
// This file spends more rounds than the default global cap; that cap has its
// own file, against a database of its own.
process.env.QUESTION_AGENT_GLOBAL_ROUNDS_PER_5H = '100000';

const {
    databaseAvailable, skipReason, startServer, createClient,
    seedUser, authenticateClient, deleteUser, closePool,
} = await import('./helpers/server.mjs');

const available = await databaseAvailable();
const skip = available ? false : skipReason();

let server;
const users = [];

before(async () => {
    if (!available) return;
    server = await startServer();
});

after(async () => {
    upstream.closeAllConnections();
    upstream.close();
    if (!available) return;
    for (const user of users) await deleteUser(user.id);
    await server.close();
    await closePool();
});

async function newAccount() {
    const user = await seedUser();
    users.push(user);
    return { user, client: authenticateClient(createClient(server.baseUrl), user) };
}

async function newDiagnosis(client, overrides = {}) {
    const res = await client.post('/api/patients', {
        nombre: 'Paciente Preguntas',
        historiaClinica: 'Tos crónica y talla baja. No presenta convulsiones.',
        symptomsExtracted: [
            { description: 'Tos crónica', code: 'HP:0012735' },
            { description: 'Talla baja', code: 'HP:0004322' },
            { description: 'Agregado a mano', code: 'HP:0002205' },
        ],
        phenotypes: [
            { hpo_id: 'HP:0012735', negated: false },
            { hpo_id: 'HP:0004322', negated: false },
            { hpo_id: 'HP:0001250', label_es: 'Convulsiones', negated: true },
        ],
        genphenGenes: [{ gene_symbol: 'CFTR', gene_id: 'CFTR', score: 0.5 }],
        ...overrides,
    });
    assert.equal(res.status, 201, res.text);
    return res.json.diagnosisId;
}

async function storedSession(diagnosisId) {
    const { query } = await import('../dist/database/pool.js');
    const res = await query('SELECT preguntas_respuestas FROM diagnoses WHERE id = $1', [diagnosisId]);
    return res.rows[0].preguntas_respuestas;
}

const answer = (ids, value = 'si') => ids.map((hpoId) => ({ hpoId, answer: value }));

async function withBehaviour(fn, run) {
    behaviour = fn;
    try {
        return await run();
    } finally {
        behaviour = null;
    }
}

test('status reports the feature as enabled', { skip }, async () => {
    const { client } = await newAccount();
    const res = await client.get('/api/questions/status');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { enabled: true });
});

test('a full session: round 1, answers, round 2, finish — persisted and resumable', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);
    calls.length = 0;

    const round1 = await client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });
    assert.equal(round1.status, 200, round1.text);
    assert.equal(round1.json.round, 1);
    assert.equal(round1.json.mode, 'paciente');
    assert.equal(round1.json.status, 'questions');
    assert.deepEqual(round1.json.questions[0], {
        id: `r1-${questionIds(1)[0]}`,
        hpoId: questionIds(1)[0],
        label: `Etiqueta ${questionIds(1)[0]}`,
        text: `¿Pregunta sobre ${questionIds(1)[0]}?`,
        help: null,
        genesIfYes: null,
        genesIfNo: null,
        rationale: null,
    });
    assert.deepEqual(round1.json.questions.map((q) => q.hpoId), questionIds(1));
    assert.deepEqual(round1.json.questions.map((q) => q.label), questionIds(1).map((id) => `Etiqueta ${id}`));
    assert.deepEqual(round1.json.ranking[0], {
        geneId: 'CFTR', geneSymbol: 'CFTR', score: 0.6, modelScore: 0.41, modelRank: 1,
    });
    assert.equal(round1.json.versions, undefined, 'agent versions reached the browser');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/v1/rounds');
    assert.equal(calls[0].headers['x-internal-token'], INTERNAL_TOKEN);
    assert.deepEqual(calls[0].body, {
        mode: 'paciente',
        round: 1,
        present_hpo_ids: ['HP:0012735', 'HP:0004322', 'HP:0002205'],
        absent_hpo_ids: ['HP:0001250'],
        answers: [],
        finish: false,
    });

    const replay = await client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.json, round1.json);
    assert.equal(calls.length, 1, 'repeating round 1 called the agent again');

    const round2 = await client.post('/api/questions/rounds', {
        diagnosisId,
        mode: 'paciente',
        answers: [
            { hpoId: questionIds(1)[0], answer: 'si', note: '  desde bebé ' },
            { hpoId: questionIds(1)[1], answer: 'no' },
            { hpoId: questionIds(1)[2], answer: 'no_se', note: null },
        ],
    });
    assert.equal(round2.status, 200, round2.text);
    assert.equal(round2.json.round, 2);
    assert.deepEqual(round2.json.questions.map((q) => q.hpoId), questionIds(2));
    assert.equal(round2.json.interpretedAnswers.length, 3);
    assert.equal(calls[1].body.round, 2);
    assert.deepEqual(calls[1].body.answers, [
        { hpo_id: questionIds(1)[0], answer: 'si', note: 'desde bebé', reading: null },
        { hpo_id: questionIds(1)[1], answer: 'no', note: null, reading: null },
        { hpo_id: questionIds(1)[2], answer: 'no_se', note: null, reading: null },
    ]);
    assert.deepEqual(round2.json.interpretedAnswers[0], {
        hpoId: questionIds(1)[0], answer: 'si', effectiveAnswer: 'si', noteSummary: 'Leído: desde bebé',
    });

    const final = await client.post('/api/questions/rounds', {
        diagnosisId, mode: 'paciente', answers: answer(questionIds(2), 'no'), finish: true,
    });
    assert.equal(final.status, 200, final.text);
    assert.equal(final.json.status, 'finished');
    assert.equal(final.json.finishReason, 'user_finished');
    assert.equal(final.json.summary, 'Resumen para llevar a la consulta.');
    assert.deepEqual(final.json.questions, []);
    assert.equal(calls[2].body.round, 3);
    assert.equal(calls[2].body.finish, true);
    assert.deepEqual(calls[2].body.answers, [
        {
            hpo_id: questionIds(1)[0], answer: 'si', note: 'desde bebé',
            reading: { effective_answer: 'si', note_summary: 'Leído: desde bebé' },
        },
        {
            hpo_id: questionIds(1)[1], answer: 'no', note: null,
            reading: { effective_answer: 'no', note_summary: null },
        },
        {
            hpo_id: questionIds(1)[2], answer: 'no_se', note: null,
            reading: { effective_answer: 'no_se', note_summary: null },
        },
        ...questionIds(2).map((id) => ({ hpo_id: id, answer: 'no', note: null, reading: null })),
    ], 'the agent must receive every answer so far, the earlier ones with their reading');

    const stored = await storedSession(diagnosisId);
    assert.equal(stored.version, 2);
    assert.equal('mode' in stored, false);
    assert.equal(stored.finished, true);
    assert.deepEqual(stored.rounds.map((r) => r.round), [1, 2, 3]);
    assert.deepEqual(stored.rounds.map((r) => r.mode), ['paciente', 'paciente', 'paciente']);
    assert.deepEqual(stored.rounds[0].questions[0], {
        id: `r1-${questionIds(1)[0]}`,
        hpoId: questionIds(1)[0],
        label: `Etiqueta ${questionIds(1)[0]}`,
        text: `¿Pregunta sobre ${questionIds(1)[0]}?`,
    });
    assert.deepEqual(stored.rounds[0].answers[0], { hpoId: questionIds(1)[0], answer: 'si', note: 'desde bebé' });
    assert.equal(stored.rounds[0].answers[1].note, null);
    assert.equal(stored.rounds[1].answers.length, 3);
    assert.deepEqual(stored.rounds[2].answers, []);
    assert.equal(stored.rounds[2].response.status, 'finished');
    assert.equal(stored.rounds[2].response.versions.knowledge_base, 'kb-test');

    const resumed = await client.get(`/api/questions/${diagnosisId}`);
    assert.equal(resumed.status, 200);
    assert.deepEqual(Object.keys(resumed.json.session).sort(), ['finished', 'latest', 'rounds']);
    assert.equal(resumed.json.session.finished, true);
    assert.equal(resumed.json.session.rounds.length, 3);
    assert.deepEqual(resumed.json.session.rounds[0].questions, round1.json.questions);
    assert.deepEqual(resumed.json.session.rounds[0].answers, [
        { hpoId: questionIds(1)[0], answer: 'si', note: 'desde bebé' },
        { hpoId: questionIds(1)[1], answer: 'no', note: null },
        { hpoId: questionIds(1)[2], answer: 'no_se', note: null },
    ]);
    assert.deepEqual(resumed.json.session.rounds[2], { round: 3, mode: 'paciente', questions: [], answers: [] });
    assert.deepEqual(resumed.json.session.latest, final.json);
    assert.ok(!resumed.text.includes('kb-test'), 'agent versions reached the browser');
    assert.ok(resumed.json.session.rounds.every((r) => !('response' in r)), 'a stored upstream response reached the browser');

    const again = await client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });
    assert.equal(again.status, 409);
    assert.deepEqual(again.json, {
        error: 'Las preguntas de este diagnóstico ya terminaron.',
        code: 'finished',
    });
    assert.equal(calls.length, 3);
});

test('the agent gets the patient\'s sex, age and earliest exact onset with every round', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client, {
        sexo: 'masculino',
        fechaNacimiento: '2012-03-01',
        symptomsExtracted: [
            { description: 'Tos crónica', code: 'HP:0012735', onset: { hpo_id: 'HP:0011463', age_years: 3 } },
            { description: 'Talla baja', code: 'HP:0004322', onset: { hpo_id: 'HP:0003621', age_years: 6.5 } },
        ],
    });
    const { query } = await import('../dist/database/pool.js');
    const { rows } = await query('SELECT created_at FROM diagnoses WHERE id = $1', [diagnosisId]);
    const day = new Date(rows[0].created_at);
    const expectedAge = Math.round(
        ((Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - Date.UTC(2012, 2, 1)) / 86_400_000 / 365.25) * 100,
    ) / 100;
    calls.length = 0;

    const round1 = await client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });
    assert.equal(round1.status, 200, round1.text);
    const round2 = await client.post('/api/questions/rounds', {
        diagnosisId, mode: 'paciente', answers: answer(questionIds(1), 'no'),
    });
    assert.equal(round2.status, 200, round2.text);

    assert.equal(calls.length, 2);
    for (const call of calls) {
        assert.equal(call.body.sex, 'male');
        assert.equal(call.body.age_years, expectedAge);
        assert.equal(call.body.onset_years, 3);
    }
});

test('a diagnosis without a session resumes as null', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);
    const res = await client.get(`/api/questions/${diagnosisId}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { session: null });
});

test('the diagnosis routes never return the stored session; /api/questions does', { skip }, async () => {
    const alice = await newAccount();
    const bob = await newAccount();
    const diagnosisId = await newDiagnosis(alice.client);
    const started = await alice.client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });
    assert.equal(started.status, 200, started.text);
    assert.notEqual(await storedSession(diagnosisId), null);

    const patients = await alice.client.get('/api/patients');
    const patientId = patients.json.find((p) => p.latest_diagnosis?.id === diagnosisId)?.id;
    assert.ok(patientId, 'the new patient is not in the list');

    const one = await alice.client.get(`/api/patients/${patientId}/diagnoses/${diagnosisId}`);
    assert.equal(one.status, 200, one.text);
    assert.equal(one.json.id, diagnosisId);
    assert.ok(Array.isArray(one.json.symptoms_extracted));
    const list = await alice.client.get(`/api/patients/${patientId}/diagnoses`);
    assert.equal(list.status, 200, list.text);
    assert.equal(list.json.length, 1);
    for (const body of [one.json, list.json[0]]) {
        assert.equal('preguntas_respuestas' in body, false, 'the raw session reached a diagnosis route');
    }
    for (const res of [one, list]) {
        assert.ok(!res.text.includes('kb-test'), 'agent versions reached a diagnosis route');
    }

    const other = await bob.client.get(`/api/patients/${patientId}/diagnoses/${diagnosisId}`);
    assert.equal(other.status, 404, 'cross-tenant diagnosis read was allowed');
    assert.ok(!other.text.includes('HP:'));
});

test('Bob can neither start nor read questions on Alice\'s diagnosis', { skip }, async () => {
    const alice = await newAccount();
    const bob = await newAccount();
    const diagnosisId = await newDiagnosis(alice.client);
    const started = await alice.client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });
    assert.equal(started.status, 200);
    calls.length = 0;

    const post = await bob.client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });
    assert.equal(post.status, 404, 'cross-tenant round was allowed');
    const answerPost = await bob.client.post('/api/questions/rounds', {
        diagnosisId, mode: 'paciente', answers: answer(questionIds(1)),
    });
    assert.equal(answerPost.status, 404, 'cross-tenant answers were accepted');

    const get = await bob.client.get(`/api/questions/${diagnosisId}`);
    assert.equal(get.status, 404, 'cross-tenant session read was allowed');
    for (const res of [post, answerPost, get]) {
        assert.ok(!res.text.includes('HP:'), 'clinical data leaked in a 404 body');
    }
    assert.equal(calls.length, 0, 'the agent was called for another account\'s diagnosis');
    assert.equal((await storedSession(diagnosisId)).rounds[0].answers.length, 0);

    const unknown = await bob.client.post('/api/questions/rounds', {
        diagnosisId: crypto.randomUUID(), mode: 'paciente',
    });
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.json, { error: 'Diagnóstico no encontrado.', code: 'not_found' });
    assert.deepEqual(unknown.json, post.json, 'not-found and not-owned must be indistinguishable');
    assert.deepEqual(get.json, post.json);
});

test('a malformed diagnosis id is 404 on both routes', { skip }, async () => {
    const { client } = await newAccount();
    for (const id of ['not-a-uuid', '1', "' OR 1=1--"]) {
        const get = await client.get(`/api/questions/${encodeURIComponent(id)}`);
        assert.equal(get.status, 404);
        const post = await client.post('/api/questions/rounds', { diagnosisId: id, mode: 'paciente' });
        assert.equal(post.status, 404);
        assert.equal(get.json.code, 'not_found');
        assert.equal(post.json.code, 'not_found');
        assert.ok(!/uuid|postgres|syntax/i.test(get.text + post.text));
    }
});

test('an invalid body is 400', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);
    const bodies = [
        {},
        { diagnosisId },
        { diagnosisId, mode: 'enfermero' },
        { diagnosisId, mode: 'paciente', answers: 'si' },
        { diagnosisId, mode: 'paciente', answers: [{ hpoId: 'HP:1', answer: 'si' }] },
        { diagnosisId, mode: 'paciente', answers: [{ hpoId: 'HP:0000001', answer: 'yes' }] },
        { diagnosisId, mode: 'paciente', answers: [{ hpoId: 'HP:0000001', answer: 'si', note: 'x'.repeat(281) }] },
        { diagnosisId, mode: 'paciente', answers: answer(['HP:0000001', 'HP:0000002', 'HP:0000003', 'HP:0000004']) },
        { diagnosisId, mode: 'paciente', finish: 'yes' },
    ];
    for (const body of bodies) {
        const res = await client.post('/api/questions/rounds', body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.deepEqual(res.json, { error: 'La solicitud no es válida.', code: 'invalid_request' });
    }
});

test('answers that do not match the pending questions are 400 and change nothing', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);

    const early = await client.post('/api/questions/rounds', {
        diagnosisId, mode: 'paciente', answers: answer(questionIds(1)),
    });
    assert.equal(early.status, 400, 'answers were accepted before any question was asked');
    assert.equal(early.json.code, 'answers_mismatch');

    await client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });
    const before = await storedSession(diagnosisId);
    calls.length = 0;

    const wrong = [
        answer(questionIds(1).slice(0, 2)),
        answer([...questionIds(1).slice(0, 2), 'HP:0000118']),
        answer(questionIds(2)),
    ];
    for (const answers of wrong) {
        const res = await client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente', answers });
        assert.equal(res.status, 400, JSON.stringify(answers));
        assert.deepEqual(res.json, {
            error: 'Las respuestas no corresponden a las preguntas pendientes.',
            code: 'answers_mismatch',
        });
    }
    assert.equal(calls.length, 0);
    assert.deepEqual(await storedSession(diagnosisId), before);
});

test('a diagnosis with no coded symptoms is refused without calling the agent', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client, { symptomsExtracted: [], phenotypes: [] });
    calls.length = 0;
    const res = await client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, {
        error: 'No pudimos usar los síntomas de esta búsqueda para hacer preguntas.',
        code: 'no_usable_symptoms',
    });
    assert.equal(calls.length, 0);
});

test('an unreachable agent is 503, with nothing stored and nothing leaked', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);

    const replies = [
        () => ({ destroy: true }),
        () => ({ status: 500, body: { detail: LEAK } }),
        () => ({ status: 503, body: { detail: LEAK } }),
        () => ({ status: 401, body: { detail: LEAK } }),
    ];
    for (const reply of replies) {
        const res = await withBehaviour(reply, () =>
            client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' }));
        assert.equal(res.status, 503, res.text);
        assert.equal(res.json.code, 'unavailable');
        assert.ok(!res.text.includes('LEAK-MARKER'), 'an upstream body reached the browser');
        assert.ok(!/Traceback|\/srv\//.test(res.text));
    }
    assert.equal(await storedSession(diagnosisId), null);
});

test('an agent answer that breaks the contract is 503 and is not stored', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);
    const bodies = [
        `<html>${LEAK}</html>`,
        { status: 'questions', ranking: LEAK },
        (request) => ({ ...agentReply(request), round: 3 }),
        (request) => ({ ...agentReply(request), questions: [] }),
    ];
    for (const body of bodies) {
        const reply = (request) => ({ status: 200, body: typeof body === 'function' ? body(request) : body });
        const res = await withBehaviour(reply, () =>
            client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' }));
        assert.equal(res.status, 503, res.text);
        assert.equal(res.json.code, 'unavailable');
        assert.ok(!res.text.includes('LEAK-MARKER'));
    }
    assert.equal(await storedSession(diagnosisId), null);
});

test('a slow agent is 504, and the answers can be sent again', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);
    await client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });

    const slow = (request) => ({ status: 200, body: agentReply(request), delayMs: 1_500 });
    const res = await withBehaviour(slow, () => client.post('/api/questions/rounds', {
        diagnosisId, mode: 'paciente', answers: answer(questionIds(1)),
    }));
    assert.equal(res.status, 504, res.text);
    assert.deepEqual(res.json, {
        error: 'El servicio de preguntas tardó demasiado en responder. Probá de nuevo.',
        code: 'timeout',
    });
    assert.equal((await storedSession(diagnosisId)).rounds[0].answers.length, 0, 'a timed-out round was stored');

    const retry = await client.post('/api/questions/rounds', {
        diagnosisId, mode: 'paciente', answers: answer(questionIds(1)),
    });
    assert.equal(retry.status, 200, retry.text);
    assert.equal(retry.json.round, 2);
});

test('a second concurrent round for the same account is refused', { skip }, async () => {
    const { client } = await newAccount();
    const first = await newDiagnosis(client);
    const second = await newDiagnosis(client);
    calls.length = 0;

    const slowish = (request) => ({ status: 200, body: agentReply(request), delayMs: 400 });
    const [a, b] = await withBehaviour(slowish, () => Promise.all([
        client.post('/api/questions/rounds', { diagnosisId: first, mode: 'paciente' }),
        client.post('/api/questions/rounds', { diagnosisId: second, mode: 'paciente' }),
    ]));
    assert.deepEqual([a.status, b.status].sort(), [200, 429]);
    const refused = a.status === 429 ? a : b;
    assert.ok(refused.headers.get('retry-after'));
    assert.deepEqual(refused.json, {
        error: 'Ya hay una ronda de preguntas en curso. Esperá a que termine.',
        code: 'round_in_flight',
    });
    assert.equal(calls.length, 1, 'both requests reached the agent');

    const later = await client.post('/api/questions/rounds', {
        diagnosisId: a.status === 429 ? first : second, mode: 'paciente',
    });
    assert.equal(later.status, 200, 'the lock was not released');
});

async function setStoredSession(diagnosisId, value) {
    const { query } = await import('../dist/database/pool.js');
    await query('UPDATE diagnoses SET preguntas_respuestas = $2::jsonb WHERE id = $1', [diagnosisId, JSON.stringify(value)]);
}

test('clinician mode: the genes each answer would favour reach the browser', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);
    calls.length = 0;

    const res = await client.post('/api/questions/rounds', { diagnosisId, mode: 'medico' });
    assert.equal(res.status, 200, res.text);
    assert.equal(calls[0].body.mode, 'medico');
    assert.equal(res.json.mode, 'medico');
    assert.deepEqual(res.json.questions[0], {
        id: `r1-${questionIds(1)[0]}`,
        hpoId: questionIds(1)[0],
        label: `Etiqueta ${questionIds(1)[0]}`,
        text: `¿Presenta ${questionIds(1)[0]}?`,
        help: null,
        genesIfYes: ['CFTR'],
        genesIfNo: ['DNAH5', 'CCDC39'],
        rationale: 'Separa CFTR de DNAH5.',
    });
    assert.equal('separates' in res.json.questions[0], false);
});

test('the mode is honoured per round and remembered per round', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);
    calls.length = 0;

    const round1 = await client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });
    assert.equal(round1.json.mode, 'paciente');
    const round2 = await client.post('/api/questions/rounds', {
        diagnosisId, mode: 'medico', answers: answer(questionIds(1)),
    });
    assert.equal(round2.status, 200, round2.text);
    assert.equal(calls[1].body.mode, 'medico');
    assert.equal(round2.json.mode, 'medico');
    assert.deepEqual(round2.json.questions[0].genesIfYes, ['CFTR']);

    const round3 = await client.post('/api/questions/rounds', {
        diagnosisId, mode: 'paciente', answers: answer(questionIds(2)),
    });
    assert.equal(calls[2].body.mode, 'paciente');
    assert.equal(round3.json.mode, 'paciente');
    assert.equal(round3.json.questions[0].genesIfYes, null);

    const resumed = await client.get(`/api/questions/${diagnosisId}`);
    assert.deepEqual(resumed.json.session.rounds.map((r) => r.mode), ['paciente', 'medico', 'paciente']);
    assert.equal(resumed.json.session.rounds[0].questions[0].genesIfYes, null);
    assert.deepEqual(resumed.json.session.rounds[1].questions[0].genesIfNo, ['DNAH5', 'CCDC39']);
    assert.equal(resumed.json.session.latest.mode, 'paciente');
});

test('a lost response: the same answers sent again replay the saved round', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);
    await client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });
    calls.length = 0;
    const body = { diagnosisId, mode: 'paciente', answers: answer(questionIds(1)) };

    // The browser gives up while the agent is still working; the backend
    // finishes the round and saves it anyway.
    const controller = new AbortController();
    const lost = withBehaviour(
        (request) => {
            setTimeout(() => controller.abort(), 50);
            return { status: 200, body: agentReply(request), delayMs: 300 };
        },
        () => fetch(`${server.baseUrl}/api/questions/rounds`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                Origin: TEST_ORIGIN,
                Cookie: [...client.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
                'X-CSRF-Token': client.jar.get('csrf_token'),
            },
            body: JSON.stringify(body),
        }),
    );
    await assert.rejects(lost, { name: 'AbortError' });
    for (let i = 0; i < 50 && (await storedSession(diagnosisId)).rounds.length < 2; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal((await storedSession(diagnosisId)).rounds.length, 2, 'the abandoned round was not saved');

    const retry = await client.post('/api/questions/rounds', body);
    assert.equal(retry.status, 200, retry.text);
    assert.equal(retry.json.round, 2);
    assert.deepEqual(retry.json.questions.map((q) => q.hpoId), questionIds(2));
    assert.equal(calls.length, 1, 'the resend called the agent again');

    const changed = await client.post('/api/questions/rounds', { ...body, answers: answer(questionIds(1), 'no') });
    assert.equal(changed.status, 400, 'different answers to an answered round were accepted');
    assert.equal(changed.json.code, 'answers_mismatch');

    const finish = { diagnosisId, mode: 'paciente', answers: answer(questionIds(2)), finish: true };
    const closed = await client.post('/api/questions/rounds', finish);
    assert.equal(closed.status, 200, closed.text);
    for (const again of [finish, { diagnosisId, mode: 'paciente', finish: true }]) {
        const res = await client.post('/api/questions/rounds', again);
        assert.equal(res.status, 200, res.text);
        assert.deepEqual(res.json, closed.json);
    }
    assert.equal(calls.length, 2, 'a repeated finish called the agent again');
});

test('finishing without answers closes the pending round in its place', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);
    await client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });
    calls.length = 0;

    const res = await client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente', finish: true });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.status, 'finished');
    assert.equal(res.json.round, 1);
    assert.equal(calls[0].body.round, 1);
    assert.equal(calls[0].body.finish, true);

    const stored = await storedSession(diagnosisId);
    assert.deepEqual(stored.rounds.map((r) => r.round), [1]);
    assert.equal(stored.finished, true);
    const resumed = await client.get(`/api/questions/${diagnosisId}`);
    assert.deepEqual(resumed.json.session.rounds, [{ round: 1, mode: 'paciente', questions: [], answers: [] }]);
    assert.deepEqual(resumed.json.session.latest, res.json);
});

test('the agent knowing none of the symptoms is a 400 that can be explained', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);
    const res = await withBehaviour(
        () => ({ status: 422, body: { error: 'no-known-hpo-ids', detail: LEAK } }),
        () => client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' }),
    );
    assert.equal(res.status, 400, res.text);
    assert.deepEqual(res.json, {
        error: 'No pudimos usar los síntomas de esta búsqueda para hacer preguntas.',
        code: 'no_usable_symptoms',
    });
    assert.equal(await storedSession(diagnosisId), null);
});

test('the other agent errors map to 503, with Retry-After passed on and capped', { skip }, async () => {
    const cases = [
        { reply: { status: 422, body: { error: 'invalid-request', detail: LEAK } }, retry: null },
        { reply: { status: 503, body: { error: 'busy' }, headers: { 'Retry-After': '7' } }, retry: '7' },
        { reply: { status: 503, body: { error: 'busy' }, headers: { 'Retry-After': '600' } }, retry: '60' },
        { reply: { status: 503, body: { error: 'model-unavailable' }, headers: { 'Retry-After': '30' } }, retry: '30' },
        { reply: { status: 413, body: { error: 'too-large' } }, retry: null },
        { reply: { status: 500, body: { error: 'internal-error', detail: LEAK } }, retry: null },
    ];
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);
    for (const { reply, retry } of cases) {
        const res = await withBehaviour(() => reply, () =>
            client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' }));
        assert.equal(res.status, 503, JSON.stringify(reply));
        assert.deepEqual(res.json, {
            error: 'El servicio de preguntas no está disponible. Probá de nuevo en unos minutos.',
            code: 'unavailable',
        });
        assert.equal(res.headers.get('retry-after'), retry, JSON.stringify(reply));
        assert.ok(!res.text.includes('LEAK-MARKER'));
    }
    assert.equal(await storedSession(diagnosisId), null);
});

test('a stored session that cannot be read is a 409, not a 500', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);
    calls.length = 0;
    for (const value of [{ version: 1, rounds: 'x' }, { version: 9 }, ['x']]) {
        await setStoredSession(diagnosisId, value);
        const get = await client.get(`/api/questions/${diagnosisId}`);
        assert.equal(get.status, 409, get.text);
        assert.deepEqual(get.json, {
            error: 'No pudimos recuperar las preguntas de esta búsqueda.',
            code: 'unreadable_session',
        });
        const post = await client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });
        assert.equal(post.status, 409, post.text);
        assert.deepEqual(post.json, get.json);
    }
    assert.equal(calls.length, 0);
});

test('a session stored by the first version is read and continued', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);
    const upstream = agentReply({ mode: 'medico', round: 1, answers: [], finish: false });
    delete upstream.mode;
    for (const q of upstream.questions) {
        delete q.genes_if_yes;
        delete q.genes_if_no;
        delete q.label;
        q.separates = ['ORPHA:586'];
    }
    await setStoredSession(diagnosisId, {
        version: 1,
        mode: 'medico',
        finished: false,
        rounds: [{
            round: 1,
            questions: upstream.questions.map((q) => ({ id: q.id, hpoId: q.hpo_id, text: q.text })),
            answers: [],
            response: upstream,
        }],
    });

    const resumed = await client.get(`/api/questions/${diagnosisId}`);
    assert.equal(resumed.status, 200, resumed.text);
    assert.equal(resumed.json.session.rounds[0].mode, 'medico');
    assert.equal(resumed.json.session.latest.mode, 'medico');
    const first = resumed.json.session.rounds[0].questions[0];
    assert.equal(first.label, first.text);
    assert.equal(first.genesIfYes, null);
    assert.ok(!resumed.text.includes('separates') && !resumed.text.includes('ORPHA'));

    calls.length = 0;
    const next = await client.post('/api/questions/rounds', {
        diagnosisId, mode: 'paciente', answers: answer(questionIds(1)),
    });
    assert.equal(next.status, 200, next.text);
    assert.equal(calls[0].body.round, 2);
    const stored = await storedSession(diagnosisId);
    assert.equal(stored.version, 2);
    assert.deepEqual(stored.rounds.map((r) => r.mode), ['medico', 'paciente']);
});

test('a save compares and sets: two writers from the same read cannot both win', { skip }, async () => {
    const { user, client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);
    const { saveQuestionSession } = await import('../dist/repositories/diagnosisRepository.js');

    const a = { version: 2, finished: false, rounds: [{ writer: 'a' }] };
    const b = { version: 2, finished: false, rounds: [{ writer: 'b' }] };
    assert.equal(await saveQuestionSession(diagnosisId, user.id, a, null), 'saved');
    assert.equal(await saveQuestionSession(diagnosisId, user.id, b, null), 'conflict');
    assert.deepEqual(await storedSession(diagnosisId), a);

    const readBack = await storedSession(diagnosisId);
    assert.equal(await saveQuestionSession(diagnosisId, user.id, b, readBack), 'saved');
    assert.equal(await saveQuestionSession(diagnosisId, user.id, a, readBack), 'conflict');
    assert.deepEqual(await storedSession(diagnosisId), b);

    assert.equal(await saveQuestionSession(crypto.randomUUID(), user.id, a, null), 'missing');
    const other = await newAccount();
    assert.equal(await saveQuestionSession(diagnosisId, other.user.id, a, readBack), 'missing');
});

test('a session changed while the agent was thinking is not overwritten', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);
    await client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' });
    const interleaved = await storedSession(diagnosisId);
    interleaved.rounds[0].answers = answer(questionIds(1), 'no').map((a) => ({ ...a, note: 'otro proceso' }));

    let write = null;
    const res = await withBehaviour(
        (request) => {
            write = setStoredSession(diagnosisId, interleaved);
            return { status: 200, body: agentReply(request), delayMs: 200 };
        },
        () => client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente', answers: answer(questionIds(1)) }),
    );
    await write;
    assert.equal(res.status, 409, res.text);
    assert.deepEqual(res.json, {
        error: 'Las preguntas de esta búsqueda cambiaron en otra pestaña. Recargá la página para continuar.',
        code: 'conflict',
    });
    assert.deepEqual(await storedSession(diagnosisId), interleaved, 'the other writer\'s round was overwritten');
});

test('NUL bytes from the agent are stripped before the session is saved', { skip }, async () => {
    const { client } = await newAccount();
    const diagnosisId = await newDiagnosis(client);
    const res = await withBehaviour(
        (request) => {
            const body = agentReply(request);
            body.questions[0].text = '¿Tos\u0000 crónica?';
            return { status: 200, body };
        },
        () => client.post('/api/questions/rounds', { diagnosisId, mode: 'paciente' }),
    );
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.questions[0].text, '¿Tos crónica?');
    assert.equal((await storedSession(diagnosisId)).rounds[0].response.questions[0].text, '¿Tos crónica?');
});

test('the hourly limit counts only rounds that reach the agent, per account', { skip }, async () => {
    const a = await newAccount();
    const b = await newAccount();
    const first = await newDiagnosis(a.client);
    calls.length = 0;

    const start = await a.client.post('/api/questions/rounds', { diagnosisId: first, mode: 'paciente' });
    assert.equal(start.status, 200);
    // None of these reach the agent, so none of them count.
    for (let i = 0; i < 12; i += 1) {
        const replay = await a.client.post('/api/questions/rounds', { diagnosisId: first, mode: 'paciente' });
        assert.equal(replay.status, 200);
        const mismatch = await a.client.post('/api/questions/rounds', {
            diagnosisId: first, mode: 'paciente', answers: answer(questionIds(2)),
        });
        assert.equal(mismatch.status, 400);
    }
    // Refused by the agent before any work: refunded.
    const busy = await withBehaviour(
        () => ({ status: 503, body: { error: 'busy' }, headers: { 'Retry-After': '5' } }),
        () => a.client.post('/api/questions/rounds', { diagnosisId: first, mode: 'paciente', finish: true }),
    );
    assert.equal(busy.status, 503);
    assert.equal(busy.json.code, 'unavailable');
    const noKnown = await withBehaviour(
        () => ({ status: 422, body: { error: 'no-known-hpo-ids' } }),
        () => a.client.post('/api/questions/rounds', { diagnosisId: first, mode: 'paciente', finish: true }),
    );
    assert.equal(noKnown.status, 400);
    assert.equal(noKnown.json.code, 'no_usable_symptoms');
    assert.equal(calls.length, 3);

    // The limit is 8: seven more rounds that reach the agent are allowed.
    for (let i = 0; i < 7; i += 1) {
        const res = await a.client.post('/api/questions/rounds', {
            diagnosisId: await newDiagnosis(a.client), mode: 'paciente',
        });
        assert.equal(res.status, 200, `round ${i + 2}: ${res.text}`);
    }
    const before = calls.length;
    const limited = await a.client.post('/api/questions/rounds', {
        diagnosisId: await newDiagnosis(a.client), mode: 'paciente',
    });
    assert.equal(limited.status, 429, limited.text);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.deepEqual(limited.json, {
        error: 'Hiciste muchas consultas seguidas. Esperá un rato y volvé a intentar.',
        code: 'rate_limited',
    });
    assert.equal(calls.length, before, 'a limited round reached the agent');

    const replay = await a.client.post('/api/questions/rounds', { diagnosisId: first, mode: 'paciente' });
    assert.equal(replay.status, 200, 'a replay was refused by the hourly limit');

    const other = await b.client.post('/api/questions/rounds', {
        diagnosisId: await newDiagnosis(b.client), mode: 'paciente',
    });
    assert.equal(other.status, 200, 'another account on the same IP was throttled');
});

test('the per-minute limit answers with the same coded body as the hourly one', { skip }, async () => {
    const { client } = await newAccount();
    let res;
    for (let i = 0; i < 61; i += 1) {
        res = await client.post('/api/questions/rounds', {});
        if (res.status === 429) break;
        assert.equal(res.status, 400, res.text);
    }
    assert.equal(res.status, 429, 'the per-minute limit never applied');
    const retryAfter = Number(res.headers.get('retry-after'));
    assert.ok(retryAfter > 0);
    assert.deepEqual(res.json, {
        error: 'Hiciste muchas consultas seguidas. Esperá un rato y volvé a intentar.',
        code: 'rate_limited',
        retryAfter,
    });
});
