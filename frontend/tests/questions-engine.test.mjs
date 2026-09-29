import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createQuestionsEngine, validateRoundBody } from '../mocks/questions-engine.mjs';

/**
 * The stand-in for the question agent is shared by dev:mock and Playwright,
 * so a lenient rule here would teach both a contract the backend does not
 * have. These pin the rules the UI relies on.
 */

const fixtures = JSON.parse(readFileSync(new URL('../mocks/fixtures.json', import.meta.url), 'utf8')).questions;
const ID = '22222222-2222-4222-8222-222222222222';
const all = (answer) => fixtures.round1.questions.map((q) => ({ hpoId: q.hpoId, answer }));

test('the family view never receives the medical fields', () => {
  const engine = createQuestionsEngine(fixtures);
  const { body } = engine.round({ diagnosisId: ID, mode: 'paciente' });
  assert.equal(body.mode, 'paciente');
  for (const question of body.questions) {
    assert.equal(question.rationale, null);
    assert.equal(question.genesIfYes, null);
    assert.equal(question.genesIfNo, null);
    assert.equal('separates' in question, false);
  }
});

test('the medical view does, in its own wording', () => {
  const engine = createQuestionsEngine(fixtures);
  const { body } = engine.round({ diagnosisId: ID, mode: 'medico' });
  assert.equal(body.mode, 'medico');
  assert.ok(body.questions.every((q) => q.rationale && (q.genesIfYes?.length || q.genesIfNo?.length)));
  assert.ok(body.questions.every((q) => q.text === fixtures.medico.questions[q.hpoId].text));
});

test('a round must answer every pending question', () => {
  const engine = createQuestionsEngine(fixtures);
  engine.round({ diagnosisId: ID, mode: 'paciente' });
  const partial = engine.round({ diagnosisId: ID, mode: 'paciente', answers: all('si').slice(0, 2) });
  assert.deepEqual(partial, {
    status: 400,
    body: { error: 'Las respuestas no corresponden a las preguntas pendientes.', code: 'answers_mismatch' },
  });
  const full = engine.round({ diagnosisId: ID, mode: 'paciente', answers: all('si') });
  assert.equal(full.status, 200);
  assert.equal(full.body.status, 'finished');
});

test('a finished session answers 409', () => {
  const engine = createQuestionsEngine(fixtures);
  engine.round({ diagnosisId: ID, mode: 'paciente' });
  engine.round({ diagnosisId: ID, mode: 'paciente', finish: true });
  assert.deepEqual(engine.round({ diagnosisId: ID, mode: 'paciente' }), {
    status: 409,
    body: { error: 'Las preguntas de este diagnóstico ya terminaron.', code: 'finished' },
  });
  assert.equal(engine.session(ID).session.finished, true);
});

test('malformed bodies are the backend\'s invalid_request 400', () => {
  const engine = createQuestionsEngine(fixtures);
  for (const body of [
    null,
    { diagnosisId: ID, mode: 'otro' },
    { diagnosisId: ID, mode: 'medico', answers: [{ hpoId: 'HP:1', answer: 'si' }] },
    { diagnosisId: ID, mode: 'medico', answers: [{ hpoId: 'HP:0001738', answer: 'quizas' }] },
    { diagnosisId: ID, mode: 'medico', answers: [{ hpoId: 'HP:0001738', answer: 'si', note: 'x'.repeat(281) }] },
  ]) {
    assert.equal(typeof validateRoundBody(body), 'string');
    assert.deepEqual(engine.round(body), {
      status: 400,
      body: { error: 'La solicitud no es válida.', code: 'invalid_request' },
    });
  }
});

test('every error the backend can send is in the fixture table, with its status', () => {
  const engine = createQuestionsEngine(fixtures);
  const expected = {
    invalid_request: 400, answers_mismatch: 400, no_usable_symptoms: 400, not_found: 404, finished: 409,
    conflict: 409, unreadable_session: 409, rate_limited: 429, global_limit: 429, round_in_flight: 429,
    internal: 500, disabled: 503, unavailable: 503, timeout: 504,
  };
  for (const [code, status] of Object.entries(expected)) {
    const { status: got, body } = engine.failure(code);
    assert.equal(got, status, code);
    assert.equal(body.code, code);
    assert.equal(typeof body.error, 'string');
  }
  assert.throws(() => engine.failure('nope'));
});

test('every question carries its HPO label', () => {
  const engine = createQuestionsEngine(fixtures);
  const { body } = engine.round({ diagnosisId: ID, mode: 'paciente' });
  assert.deepEqual(body.questions.map((q) => [q.hpoId, q.label]), [
    ['HP:0001738', 'Insuficiencia pancreática exocrina'],
    ['HP:0001696', 'Situs inversus totalis'],
    ['HP:0012236', 'Cloruro en sudor elevado'],
  ]);
});

test('a saved session has the backend shape: every round kept, blank notes null', () => {
  const engine = createQuestionsEngine(fixtures);
  const first = engine.round({ diagnosisId: ID, mode: 'paciente' });
  const answers = [
    { hpoId: 'HP:0001738', answer: 'si', note: '  desde bebé ' },
    { hpoId: 'HP:0001696', answer: 'no' },
    { hpoId: 'HP:0012236', answer: 'no_se', note: '' },
  ];
  const last = engine.round({ diagnosisId: ID, mode: 'paciente', answers });

  const { session } = engine.session(ID);
  assert.deepEqual(Object.keys(session).sort(), ['finished', 'latest', 'rounds']);
  assert.equal(session.finished, true);
  assert.deepEqual(session.rounds, [
    {
      round: 1,
      mode: 'paciente',
      questions: first.body.questions,
      answers: [
        { hpoId: 'HP:0001738', answer: 'si', note: 'desde bebé' },
        { hpoId: 'HP:0001696', answer: 'no', note: null },
        { hpoId: 'HP:0012236', answer: 'no_se', note: null },
      ],
    },
    { round: 2, mode: 'paciente', questions: [], answers: [] },
  ]);
  assert.deepEqual(session.latest, last.body);
});

test('the mode is honoured per round', () => {
  const engine = createQuestionsEngine(fixtures, { sequence: [fixtures.round1, fixtures.round1, fixtures.round2] });
  const first = engine.round({ diagnosisId: ID, mode: 'paciente' });
  const second = engine.round({ diagnosisId: ID, mode: 'medico', answers: all('si') });
  assert.equal(first.body.mode, 'paciente');
  assert.equal(second.body.mode, 'medico');
  assert.ok(second.body.questions.every((q) => q.rationale));
  assert.deepEqual(engine.session(ID).session.rounds.map((r) => r.mode), ['paciente', 'medico']);
});

test('a repeated start replays the latest round as it was written', () => {
  const engine = createQuestionsEngine(fixtures);
  engine.round({ diagnosisId: ID, mode: 'paciente' });
  const replay = engine.round({ diagnosisId: ID, mode: 'medico' });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.mode, 'paciente');
  assert.ok(replay.body.questions.every((q) => q.rationale === null));
});

test('a resend of answers already applied is replayed with 200, even once finished', () => {
  const engine = createQuestionsEngine(fixtures);
  engine.round({ diagnosisId: ID, mode: 'paciente' });
  const applied = engine.round({ diagnosisId: ID, mode: 'paciente', answers: all('si') });
  const again = engine.round({ diagnosisId: ID, mode: 'paciente', answers: all('si') });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, applied.body);
  // Different answers to the same round are not a resend.
  assert.equal(engine.round({ diagnosisId: ID, mode: 'paciente', answers: all('no') }).status, 409);
});

test('interpretedAnswers covers every round so far', () => {
  const engine = createQuestionsEngine(fixtures, { sequence: [fixtures.round1, fixtures.round1, fixtures.round2] });
  const first = engine.round({ diagnosisId: ID, mode: 'paciente' }).body;
  engine.round({ diagnosisId: ID, mode: 'paciente', answers: [
    { hpoId: first.questions[0].hpoId, answer: 'si', note: 'desde bebé' },
    { hpoId: first.questions[1].hpoId, answer: 'no' },
    { hpoId: first.questions[2].hpoId, answer: 'no_se' },
  ] });
  const closing = engine.round({ diagnosisId: ID, mode: 'paciente', finish: true }).body;
  assert.equal(closing.interpretedAnswers.length, 3);
  assert.equal(closing.interpretedAnswers[0].noteSummary, 'Desde bebé.');
});

test('every finished round has a summary in its own mode, from nothing too', () => {
  for (const mode of ['paciente', 'medico']) {
    const engine = createQuestionsEngine(fixtures);
    const done = engine.round({ diagnosisId: ID, mode, finish: true }).body;
    assert.equal(done.status, 'finished');
    assert.equal(done.summary, fixtures.summaries.early[mode]);

    const other = createQuestionsEngine(fixtures);
    other.round({ diagnosisId: ID, mode });
    assert.equal(other.round({ diagnosisId: ID, mode, answers: all('si') }).body.summary, fixtures.summaries.refined[mode]);
  }
});

test('a search with no usable symptoms is a 400 with the fixed wording, and leaves no session', () => {
  const engine = createQuestionsEngine(fixtures, { noUsableSymptoms: true });
  const result = engine.round({ diagnosisId: ID, mode: 'paciente' });
  assert.deepEqual(result, {
    status: 400,
    body: { error: 'No pudimos usar los síntomas de esta búsqueda para hacer preguntas.', code: 'no_usable_symptoms' },
  });
  assert.deepEqual(engine.session(ID), { session: null });
});

test('one round at a time per account', () => {
  const engine = createQuestionsEngine(fixtures);
  const release = engine.tryAcquire('cuenta');
  assert.ok(release);
  assert.equal(engine.tryAcquire('cuenta'), null);
  assert.equal(engine.inFlightError.status, 429);
  assert.equal(engine.inFlightError.body.code, 'round_in_flight');
  release();
  assert.ok(engine.tryAcquire('cuenta'));
});

test('finishing without answers keeps the unanswered round and closes with the same number', () => {
  const engine = createQuestionsEngine(fixtures);
  engine.round({ diagnosisId: ID, mode: 'paciente' });
  const done = engine.round({ diagnosisId: ID, mode: 'paciente', finish: true });
  assert.equal(done.body.round, 1);
  assert.equal(done.body.status, 'finished');
  const { rounds } = engine.session(ID).session;
  assert.deepEqual(rounds.map((r) => [r.round, r.questions.length, r.answers.length]), [[1, 3, 0], [1, 0, 0]]);
});

test('answers before any question are refused', () => {
  const engine = createQuestionsEngine(fixtures);
  assert.equal(engine.round({ diagnosisId: ID, mode: 'paciente', answers: all('si') }).status, 400);
  assert.deepEqual(engine.session(ID), { session: null });
});
