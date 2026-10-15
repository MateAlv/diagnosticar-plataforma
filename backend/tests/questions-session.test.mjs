import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    deriveEvidence,
    derivePatientCase,
    parseStoredSession,
    pendingRound,
    planRound,
    toBrowserRound,
    toBrowserSession,
    CorruptSessionError,
} from '../dist/services/questionSession.js';
import { roundResponseSchema } from '../dist/services/questionAgentClient.js';

/**
 * The session rules without a database or a network: which round is pending,
 * which answers are accepted, what the agent is sent, and how its snake_case
 * answer reaches the browser.
 */

const EVIDENCE = { present: ['HP:0002205', 'HP:0004322'], absent: ['HP:0001250'] };
const VERSIONS = { agent: 't', knowledge_base: 'kb', llm_model: null };

function questionsResponse(round, ids, { mode = 'paciente', interpreted = [] } = {}) {
    return roundResponseSchema.parse({
        round,
        mode,
        status: 'questions',
        finish_reason: null,
        questions: ids.map((id) => ({
            id: `r${round}-${id}`,
            hpo_id: id,
            label: `Etiqueta ${id}`,
            text: `¿${id}?`,
            help: null,
            genes_if_yes: mode === 'medico' ? ['CFTR'] : null,
            genes_if_no: mode === 'medico' ? ['DNAH5', 'CCDC39'] : null,
            rationale: mode === 'medico' ? 'Separa CFTR de DNAH5.' : null,
        })),
        ranking: [{ gene_id: 'CFTR', gene_symbol: 'CFTR', score: 0.5, model_score: 0.4, model_rank: 1 }],
        confidence: 0.7,
        interpreted_answers: interpreted,
        versions: VERSIONS,
    });
}

function finishedResponse(round, { mode = 'paciente', interpreted = [] } = {}) {
    return roundResponseSchema.parse({
        round,
        mode,
        status: 'finished',
        finish_reason: 'user_finished',
        ranking: [{ gene_id: 'CFTR', gene_symbol: 'CFTR', score: 0.8, model_score: 0.4, model_rank: 1 }],
        interpreted_answers: interpreted,
        summary: 'Resumen.',
        versions: { ...VERSIONS, llm_model: 'm' },
    });
}

const R1 = ['HP:0001738', 'HP:0001696', 'HP:0012236'];
const R2 = ['HP:0000001', 'HP:0000002', 'HP:0000003'];
const input = (overrides = {}) => ({ mode: 'paciente', answers: [], finish: false, ...overrides });
const answer = (ids, value = 'si') => ids.map((hpoId) => ({ hpoId, answer: value }));

function startedSession(mode = 'paciente') {
    const plan = planRound(null, EVIDENCE, input({ mode }));
    return plan.apply(questionsResponse(1, R1, { mode }));
}

function secondRoundSession() {
    const plan = planRound(startedSession(), EVIDENCE, input({ answers: answer(R1) }));
    return plan.apply(questionsResponse(2, R2));
}

test('present comes from the confirmed symptoms, absent from negated extractions', () => {
    const evidence = deriveEvidence({
        symptoms_extracted: [
            { description: 'Talla baja', code: 'hp:0004322 ' },
            { description: 'Manual', code: 'HP:0002205' },
            { description: 'Duplicado', code: 'HP:0002205' },
            { description: 'Código roto', code: 'HP:12' },
            null,
        ],
        phenotypes: [
            { hpo_id: 'HP:0001250', negated: true },
            // Moved back to present by the reader: present wins.
            { hpo_id: 'HP:0002205', negated: true },
            { hpo_id: 'HP:0000001', negated: false },
            { hpo_id: 'garbage', negated: true },
        ],
    });
    assert.deepEqual(evidence, { present: ['HP:0004322', 'HP:0002205'], absent: ['HP:0001250'] });
});

test('present and absent never overlap, whatever the casing or the cap', () => {
    const ids = Array.from({ length: 130 }, (_, i) => `HP:${String(i + 1).padStart(7, '0')}`);
    const evidence = deriveEvidence({
        symptoms_extracted: ids.map((code) => ({ code })),
        // Every present term, also negated (in lower case), plus a few only negated.
        phenotypes: [
            ...ids.map((id) => ({ hpo_id: ` ${id.toLowerCase()}`, negated: true })),
            { hpo_id: 'HP:0009999', negated: true },
        ],
    });
    assert.equal(evidence.present.length, 100);
    // Terms past the cap of present are still not sent as absent.
    assert.deepEqual(evidence.absent, ['HP:0009999']);
    const present = new Set(evidence.present);
    assert.ok(evidence.absent.every((id) => !present.has(id)));
});

test('evidence tolerates rows saved before the columns held arrays', () => {
    assert.deepEqual(deriveEvidence({ symptoms_extracted: null, phenotypes: {} }), { present: [], absent: [] });
});

test('evidence is capped at the agent limit of 100 terms', () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ code: `HP:${String(i + 1).padStart(7, '0')}` }));
    assert.equal(deriveEvidence({ symptoms_extracted: many, phenotypes: [] }).present.length, 100);
});

test('the first POST asks the agent for round 1 with no answers', () => {
    const plan = planRound(null, EVIDENCE, input({ mode: 'medico' }));
    assert.equal(plan.action, 'call');
    assert.deepEqual(plan.request, {
        mode: 'medico',
        round: 1,
        present_hpo_ids: EVIDENCE.present,
        absent_hpo_ids: EVIDENCE.absent,
        answers: [],
        finish: false,
    });
});

const DIAGNOSED = new Date('2026-10-09T15:00:00Z');
const withOnset = (code, onset) => ({ description: code, code, onset });

test('the case is the sex, the age on the day of the diagnosis and the earliest exact onset', () => {
    const patientCase = derivePatientCase({
        sexo: 'Femenino',
        fecha_nacimiento: '2019-04-09',
        created_at: DIAGNOSED,
        symptoms_extracted: [
            withOnset('HP:0012735', { hpo_id: 'HP:0011463', age_years: 3 }),
            withOnset('HP:0004322', { hpo_id: 'HP:0003593', age_years: 0.5 }),
            withOnset('HP:0002205', { hpo_id: 'HP:0003623', age_years: null }),
            { description: 'Sin inicio', code: 'HP:0001250' },
        ],
    });
    assert.deepEqual(patientCase, { sex: 'female', age_years: 7.5, onset_years: 0.5 });
});

test('whatever is not known is left out of the case', () => {
    const empty = { sexo: null, fecha_nacimiento: null, created_at: DIAGNOSED, symptoms_extracted: [] };
    assert.deepEqual(derivePatientCase(empty), {});
    assert.deepEqual(derivePatientCase({ ...empty, sexo: 'otro' }), {});
    assert.deepEqual(derivePatientCase({ ...empty, sexo: ' masculino ' }), { sex: 'male' });
    assert.deepEqual(derivePatientCase({ ...empty, fecha_nacimiento: '2026-10-10' }), {}, 'born after the diagnosis');
    assert.deepEqual(derivePatientCase({ ...empty, fecha_nacimiento: '1880-01-01' }), {}, 'older than the agent accepts');
    assert.deepEqual(derivePatientCase({ ...empty, fecha_nacimiento: '2026-10-09' }), { age_years: 0 });
    assert.deepEqual(
        derivePatientCase({ ...empty, symptoms_extracted: [withOnset('HP:0012735', { hpo_id: 'HP:0011463', age_years: null })] }),
        {},
        'an onset class alone is not an exact age',
    );
    assert.deepEqual(derivePatientCase({ ...empty, symptoms_extracted: 'not an array' }), {});
});

test('every call carries the case, and none does without one', () => {
    const patientCase = { sex: 'male', age_years: 14.57, onset_years: 3 };
    const first = planRound(null, EVIDENCE, input(), patientCase);
    assert.deepEqual(first.request, {
        mode: 'paciente',
        round: 1,
        present_hpo_ids: EVIDENCE.present,
        absent_hpo_ids: EVIDENCE.absent,
        sex: 'male',
        age_years: 14.57,
        onset_years: 3,
        answers: [],
        finish: false,
    });

    const second = planRound(first.apply(questionsResponse(1, R1)), EVIDENCE, input({ answers: answer(R1) }), patientCase);
    assert.equal(second.action, 'call');
    assert.equal(second.request.sex, 'male');
    assert.equal(second.request.onset_years, 3);

    const without = planRound(null, EVIDENCE, input());
    assert.equal('sex' in without.request || 'age_years' in without.request || 'onset_years' in without.request, false);
});

test('a diagnosis with no coded symptoms cannot start a session', () => {
    const plan = planRound(null, { present: [], absent: [] }, input());
    assert.deepEqual(plan, { action: 'reject', reason: 'no_evidence' });
});

test('repeating the first POST replays the pending round instead of calling again', () => {
    const session = startedSession();
    const plan = planRound(session, EVIDENCE, input());
    assert.equal(plan.action, 'replay');
    assert.equal(plan.response.round, 1);
});

test('answers must cover exactly the pending questions', () => {
    const session = startedSession();
    const cases = [
        R1.slice(0, 2),
        [...R1.slice(0, 2), 'HP:0000118'],
        [R1[0], R1[0], R1[1]],
    ];
    for (const ids of cases) {
        const plan = planRound(session, EVIDENCE, input({ answers: answer(ids) }));
        assert.deepEqual(plan, { action: 'reject', reason: 'answers_mismatch' }, ids.join(','));
    }
});

test('answers without a session are rejected', () => {
    const plan = planRound(null, EVIDENCE, input({ answers: [{ hpoId: R1[0], answer: 'si' }] }));
    assert.deepEqual(plan, { action: 'reject', reason: 'answers_mismatch' });
});

test('every round sends all answers so far, each earlier one with its first reading', () => {
    let session = startedSession();
    const answers1 = [
        { hpoId: R1[0], answer: 'si', note: '  desde bebé  ' },
        { hpoId: R1[1], answer: 'no', note: '' },
        { hpoId: R1[2], answer: 'no_se' },
    ];
    let plan = planRound(session, EVIDENCE, input({ answers: answers1 }));
    assert.equal(plan.request.round, 2);
    assert.deepEqual(plan.request.answers, [
        { hpo_id: R1[0], answer: 'si', note: 'desde bebé', reading: null },
        { hpo_id: R1[1], answer: 'no', note: null, reading: null },
        { hpo_id: R1[2], answer: 'no_se', note: null, reading: null },
    ]);
    session = plan.apply(questionsResponse(2, R2, {
        interpreted: [
            { hpo_id: R1[0], answer: 'si', effective_answer: 'si', note_summary: 'Desde el nacimiento.' },
            { hpo_id: R1[1], answer: 'no', effective_answer: 'no', note_summary: null },
            { hpo_id: R1[2], answer: 'no_se', effective_answer: 'no_se' },
        ],
    }));
    assert.equal(session.rounds.length, 2);
    assert.equal(session.rounds[0].answers.length, 3);
    assert.deepEqual(pendingRound(session).questions.map((q) => q.hpoId), R2);

    plan = planRound(session, EVIDENCE, input({ answers: answer(R2, 'no'), finish: true }));
    assert.equal(plan.request.round, 3);
    assert.equal(plan.request.finish, true);
    assert.deepEqual(plan.request.answers, [
        {
            hpo_id: R1[0], answer: 'si', note: 'desde bebé',
            reading: { effective_answer: 'si', note_summary: 'Desde el nacimiento.' },
        },
        { hpo_id: R1[1], answer: 'no', note: null, reading: { effective_answer: 'no', note_summary: null } },
        { hpo_id: R1[2], answer: 'no_se', note: null, reading: { effective_answer: 'no_se', note_summary: null } },
        ...R2.map((id) => ({ hpo_id: id, answer: 'no', note: null, reading: null })),
    ]);

    session = plan.apply(finishedResponse(3));
    assert.equal(session.finished, true);
    assert.equal(pendingRound(session), null);
    assert.deepEqual(planRound(session, EVIDENCE, input()), { action: 'reject', reason: 'finished' });
});

test('the first reading of an answer wins over later ones', () => {
    let session = secondRoundSession();
    session.rounds[0].response.interpreted_answers = [];
    session.rounds[1].response.interpreted_answers = [
        { hpo_id: R1[0], answer: 'si', effective_answer: 'no_se', note_summary: 'Primera lectura.' },
    ];
    let plan = planRound(session, EVIDENCE, input({ answers: answer(R2) }));
    session = plan.apply(questionsResponse(3, ['HP:0000004'], {
        interpreted: [{ hpo_id: R1[0], answer: 'si', effective_answer: 'si', note_summary: 'Otra.' }],
    }));
    plan = planRound(session, EVIDENCE, input({ answers: answer(['HP:0000004']) }));
    assert.deepEqual(plan.request.answers[0].reading, { effective_answer: 'no_se', note_summary: 'Primera lectura.' });
});

test('each round uses the mode of its own request', () => {
    let session = startedSession('paciente');
    const plan = planRound(session, EVIDENCE, input({ mode: 'medico', answers: answer(R1) }));
    assert.equal(plan.request.mode, 'medico');
    session = plan.apply(questionsResponse(2, R2, { mode: 'medico' }));
    assert.deepEqual(session.rounds.map((r) => r.mode), ['paciente', 'medico']);

    const view = toBrowserSession(session);
    assert.deepEqual(view.rounds.map((r) => r.mode), ['paciente', 'medico']);
    assert.equal(view.latest.mode, 'medico');
    assert.deepEqual(view.rounds[1].questions[0].genesIfYes, ['CFTR']);
    assert.equal(view.rounds[0].questions[0].genesIfYes, null);

    const back = planRound(session, EVIDENCE, input({ mode: 'paciente', answers: answer(R2) }));
    assert.equal(back.request.mode, 'paciente');
});

test('resending the answers of a round the session moved past replays the latest round', () => {
    const session = secondRoundSession();
    const plan = planRound(session, EVIDENCE, input({ answers: answer(R1) }));
    assert.equal(plan.action, 'replay');
    assert.equal(plan.response.round, 2);
    assert.deepEqual(plan.response.questions.map((q) => q.hpo_id), R2);

    // Same ids with a different answer or note is not a resend.
    for (const answers of [answer(R1, 'no'), [{ hpoId: R1[0], answer: 'si', note: 'otra' }, ...answer(R1.slice(1))]]) {
        assert.deepEqual(planRound(session, EVIDENCE, input({ answers })), { action: 'reject', reason: 'answers_mismatch' });
    }
});

test('resending the last answers or finish after the session closed replays the closing round', () => {
    let session = secondRoundSession();
    session = planRound(session, EVIDENCE, input({ answers: answer(R2), finish: true })).apply(finishedResponse(3));
    for (const again of [input({ answers: answer(R2), finish: true }), input({ finish: true }), input({ answers: answer(R2) })]) {
        const plan = planRound(session, EVIDENCE, again);
        assert.equal(plan.action, 'replay', JSON.stringify(again));
        assert.equal(plan.response.status, 'finished');
    }
    assert.deepEqual(planRound(session, EVIDENCE, input({ answers: answer(R1) })), { action: 'reject', reason: 'finished' });
    assert.deepEqual(planRound(session, EVIDENCE, input()), { action: 'reject', reason: 'finished' });
});

test('finish is not a resend while the session is still open', () => {
    const plan = planRound(secondRoundSession(), EVIDENCE, input({ answers: answer(R1), finish: true }));
    assert.deepEqual(plan, { action: 'reject', reason: 'answers_mismatch' });
});

test('finishing without answering replaces the pending round with the closing one', () => {
    const session = secondRoundSession();
    const plan = planRound(session, EVIDENCE, input({ finish: true }));
    assert.equal(plan.request.round, 2);
    assert.equal(plan.request.answers.length, 3);
    const done = plan.apply(finishedResponse(2));
    assert.equal(done.finished, true);
    assert.deepEqual(done.rounds.map((r) => r.round), [1, 2]);
    assert.deepEqual(done.rounds[1].questions, []);
    assert.equal(done.rounds[1].response.status, 'finished');
    assert.equal(done.rounds[0].answers.length, 3);

    const first = planRound(startedSession(), EVIDENCE, input({ finish: true }));
    assert.deepEqual(first.apply(finishedResponse(1)).rounds.map((r) => r.round), [1]);
});

test('the stored session is validated on the way out of the database', () => {
    assert.equal(parseStoredSession(null), null);
    const session = startedSession();
    assert.deepEqual(parseStoredSession(JSON.parse(JSON.stringify(session))), session);
    for (const raw of [{ version: 3 }, { version: 2, finished: false, rounds: [] }, 'x', { version: 1, rounds: 'x' }]) {
        assert.throws(() => parseStoredSession(raw), (error) => {
            assert.ok(error instanceof CorruptSessionError, JSON.stringify(raw));
            assert.equal(error.name, 'CorruptSessionError');
            return true;
        });
    }
});

test('a stored session tolerates fields added or dropped since it was written', () => {
    const raw = JSON.parse(JSON.stringify(startedSession()));
    const question = raw.rounds[0].response.questions[0];
    delete question.genes_if_yes;
    delete question.genes_if_no;
    delete question.help;
    question.some_future_field = 'x';
    raw.rounds[0].response.some_future_field = 'y';
    delete raw.rounds[0].response.versions;
    const session = parseStoredSession(raw);
    assert.equal(session.rounds[0].response.questions[0].genes_if_yes, null);
    assert.equal(session.rounds[0].response.questions[0].help, null);
    assert.equal(session.rounds[0].response.versions, null);
    assert.ok(!JSON.stringify(session).includes('some_future_field'));
});

test('a version 1 session is read as the current shape and continues', () => {
    // As the first version of this backend stored it: one mode for the whole
    // session, `separates` on questions, no response mode, no stored label.
    const v1 = {
        version: 1,
        mode: 'medico',
        finished: false,
        rounds: [{
            round: 1,
            questions: R1.map((id) => ({ id: `r1-${id}`, hpoId: id, text: `¿${id}?` })),
            answers: [],
            response: {
                round: 1,
                status: 'questions',
                finish_reason: null,
                questions: R1.map((id) => ({
                    id: `r1-${id}`, hpo_id: id, text: `¿${id}?`, help: null, separates: ['ORPHA:1'], rationale: 'r',
                })),
                ranking: [{ gene_id: 'CFTR', gene_symbol: 'CFTR', score: 0.5, model_score: 0.4, model_rank: 1 }],
                specialties: null,
                confidence: 0.7,
                interpreted_answers: [],
                summary: null,
                warnings: [],
                versions: VERSIONS,
            },
        }],
    };
    const session = parseStoredSession(v1);
    assert.equal(session.version, 2);
    assert.equal(session.rounds[0].mode, 'medico');
    assert.equal(session.rounds[0].response.mode, 'medico');
    assert.equal(session.rounds[0].questions[0].label, `¿${R1[0]}?`);

    const view = toBrowserSession(session);
    assert.deepEqual(view.rounds[0].questions[0], {
        id: `r1-${R1[0]}`, hpoId: R1[0], label: `¿${R1[0]}?`, text: `¿${R1[0]}?`,
        help: null, genesIfYes: null, genesIfNo: null, rationale: 'r',
    });
    assert.ok(!JSON.stringify(view).includes('separates'));

    const plan = planRound(session, EVIDENCE, input({ mode: 'paciente', answers: answer(R1) }));
    assert.equal(plan.action, 'call');
    assert.equal(plan.request.round, 2);
    const next = plan.apply(questionsResponse(2, R2));
    assert.equal(next.version, 2);
    assert.deepEqual(next.rounds.map((r) => r.mode), ['medico', 'paciente']);
});

test('the browser gets camelCase, the mode, and never the agent versions', () => {
    const upstream = roundResponseSchema.parse({
        round: 2,
        mode: 'paciente',
        status: 'finished',
        finish_reason: 'confident',
        ranking: [{ gene_id: '1080', gene_symbol: 'CFTR', score: 0.81, model_score: 0.46, model_rank: 1 }],
        specialties: { top_specialty: 'Pulmonology' },
        confidence: 0.81,
        interpreted_answers: [
            { hpo_id: 'HP:0001738', answer: 'si', effective_answer: 'no_se', note_summary: 'Contradice.' },
        ],
        summary: 'Resumen.',
        warnings: ['w'],
        versions: { agent: '2.0.0', knowledge_base: 'kb-v1', llm_model: 'secret-model' },
    });
    const body = toBrowserRound(upstream);
    assert.deepEqual(body, {
        round: 2,
        mode: 'paciente',
        status: 'finished',
        finishReason: 'confident',
        questions: [],
        ranking: [{ geneId: '1080', geneSymbol: 'CFTR', score: 0.81, modelScore: 0.46, modelRank: 1 }],
        specialties: { top_specialty: 'Pulmonology' },
        confidence: 0.81,
        interpretedAnswers: [
            { hpoId: 'HP:0001738', answer: 'si', effectiveAnswer: 'no_se', noteSummary: 'Contradice.' },
        ],
        summary: 'Resumen.',
        warnings: ['w'],
    });
    assert.ok(!JSON.stringify(body).includes('secret-model'));
});

test('optional upstream fields become explicit nulls for the browser', () => {
    const body = toBrowserRound(questionsResponse(1, R1));
    assert.deepEqual(body.questions[0], {
        id: `r1-${R1[0]}`,
        hpoId: R1[0],
        label: `Etiqueta ${R1[0]}`,
        text: `¿${R1[0]}?`,
        help: null,
        genesIfYes: null,
        genesIfNo: null,
        rationale: null,
    });
    assert.equal(body.finishReason, null);
    assert.equal(body.summary, null);
    assert.equal(body.specialties, null);
    assert.deepEqual(body.interpretedAnswers, []);
});

test('clinician mode maps the genes each answer would favour', () => {
    const body = toBrowserRound(questionsResponse(1, R1, { mode: 'medico' }));
    assert.equal(body.mode, 'medico');
    assert.deepEqual(body.questions[0].genesIfYes, ['CFTR']);
    assert.deepEqual(body.questions[0].genesIfNo, ['DNAH5', 'CCDC39']);
    assert.equal(body.questions[0].rationale, 'Separa CFTR de DNAH5.');
});

test('a patient-mode round never shows gene names or the rationale, whatever the agent sent', () => {
    const upstream = questionsResponse(1, R1, { mode: 'paciente' });
    upstream.questions[0].genes_if_yes = ['CFTR'];
    upstream.questions[0].genes_if_no = ['DNAH5'];
    upstream.questions[0].rationale = 'Separa CFTR de DNAH5.';
    const body = toBrowserRound(upstream);
    assert.equal(body.questions[0].genesIfYes, null);
    assert.equal(body.questions[0].genesIfNo, null);
    assert.equal(body.questions[0].rationale, null);
});

test('the stored round keeps each question with its label and its mode', () => {
    const round = startedSession('medico').rounds[0];
    assert.equal(round.mode, 'medico');
    assert.deepEqual(round.questions[0], {
        id: `r1-${R1[0]}`, hpoId: R1[0], label: `Etiqueta ${R1[0]}`, text: `¿${R1[0]}?`,
    });
});

test('the resumable session lists every round and the latest body', () => {
    const view = toBrowserSession(startedSession());
    assert.equal(view.finished, false);
    assert.equal(view.rounds.length, 1);
    assert.equal(view.rounds[0].mode, 'paciente');
    assert.deepEqual(view.rounds[0].questions.map((q) => q.hpoId), R1);
    assert.deepEqual(view.rounds[0].questions.map((q) => q.label), R1.map((id) => `Etiqueta ${id}`));
    assert.deepEqual(view.rounds[0].answers, []);
    assert.equal(view.latest.status, 'questions');
});

test('the resumable session carries no stored upstream response and no session-level mode', () => {
    const view = toBrowserSession(startedSession());
    assert.deepEqual(Object.keys(view).sort(), ['finished', 'latest', 'rounds']);
    assert.deepEqual(Object.keys(view.rounds[0]).sort(), ['answers', 'mode', 'questions', 'round']);
    assert.ok(!JSON.stringify(view).includes('knowledge_base'), 'agent versions reached the browser');
});

test('the response contract rejects shapes the session could not continue from', () => {
    const base = {
        round: 1, mode: 'paciente', ranking: [], versions: { agent: 'a', knowledge_base: 'k', llm_model: null },
    };
    const question = { id: 'q', hpo_id: 'HP:0000001', label: 'Anomalía fenotípica', text: 't' };
    assert.equal(roundResponseSchema.safeParse({ ...base, status: 'questions', questions: [question] }).success, true);
    const bad = [
        { ...base, status: 'questions', questions: [] },
        { ...base, status: 'finished', questions: [question] },
        { ...base, round: 4, status: 'questions', questions: [question] },
        {
            ...base,
            status: 'questions',
            questions: [
                { ...question, id: 'a' },
                { ...question, id: 'b' },
            ],
        },
        { ...base, status: 'questions', questions: [{ id: 'q', hpo_id: 'HP:0000001', text: 't' }] },
        { ...base, status: 'finished', versions: undefined },
        { ...base, status: 'finished', mode: 'enfermero' },
    ];
    for (const candidate of bad) {
        assert.equal(roundResponseSchema.safeParse(candidate).success, false, JSON.stringify(candidate));
    }
});
