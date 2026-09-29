import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importTs } from './helpers/ts-module.mjs';
import { createQuestionsEngine } from '../mocks/questions-engine.mjs';

/**
 * The question session's transitions, without a browser.
 *
 * The rule under test: when a reply is lost, times out or conflicts, the
 * saved session is the truth. The screen adopts it when the server moved on,
 * and nothing it does afterwards resends answers to a round that is no
 * longer pending.
 */

const {
  INITIAL_STATE,
  ROUND_TIMEOUT_MS,
  afterAnswers,
  afterFailure,
  afterFinish,
  afterReconcile,
  afterStart,
  beginRequest,
  fromSession,
  planFailure,
  serverMovedOn,
  RATE_LIMIT_HOLD_SECONDS,
} = await importTs('lib/questions-api.ts', 'lib/question-session.ts');

const fixtures = JSON.parse(readFileSync(new URL('../mocks/fixtures.json', import.meta.url), 'utf8')).questions;
const ID = '22222222-2222-4222-8222-222222222222';
const failure = (status, code = null, retryAfterSeconds = null) => ({ ok: false, status, code, retryAfterSeconds });

function playedRound1(mode = 'paciente') {
  const engine = createQuestionsEngine(fixtures);
  const { body } = engine.round({ diagnosisId: ID, mode });
  return { engine, state: afterStart(beginRequest(INITIAL_STATE, 'start'), body), round1: body };
}

const allAnswers = (round, answer = 'si') => round.questions.map((q) => ({ hpoId: q.hpoId, answer }));

test('the client gives up after the backend would have', () => {
  assert.ok(ROUND_TIMEOUT_MS >= 100_000 + 5_000);
});

test('a first round shows its questions and moves focus', () => {
  const { state } = playedRound1();
  assert.equal(state.phase, 'questions');
  assert.equal(state.pending, null);
  assert.equal(state.latest.round, 1);
  assert.equal(state.focusToken, 1);
});

test('answers fold into the history and become the refined ranking', () => {
  const { engine, state, round1 } = playedRound1();
  const answers = allAnswers(round1);
  const { body } = engine.round({ diagnosisId: ID, mode: 'paciente', answers });
  const next = afterAnswers(state, round1, answers, body);
  assert.equal(next.phase, 'finished');
  assert.equal(next.refined, body);
  assert.equal(next.history.length, 3);
  assert.ok(next.history.every((item) => item.mode === 'paciente'));
});

test('finishing with nothing answered keeps the original ranking on screen', () => {
  const { engine, state } = playedRound1();
  const { body } = engine.round({ diagnosisId: ID, mode: 'paciente', finish: true });
  const next = afterFinish(state, body);
  assert.equal(next.phase, 'finished');
  assert.equal(next.refined, null);
  assert.ok(body.summary, 'a finish from nothing still has a summary');
});

test('a lost reply is settled by adopting the round the server already served, silently', () => {
  const { engine, state, round1 } = playedRound1();
  // The server applied the answers; the reply never arrived.
  engine.round({ diagnosisId: ID, mode: 'paciente', answers: allAnswers(round1) });

  const plan = planFailure(failure(0), false);
  assert.equal(plan.recover, true);
  const next = afterFailure(beginRequest(state, 'answers'), plan, engine.session(ID).session);
  assert.equal(next.phase, 'finished');
  assert.equal(next.error, null);
  assert.equal(next.pending, null);
  assert.equal(next.history.length, 3);
  assert.equal(next.uncertain, false);
});

test('a client timeout is handled like a lost reply', () => {
  const plan = planFailure(failure(0), true);
  assert.equal(plan.status, 504);
  assert.equal(plan.recover, true);
  assert.equal(plan.unknownOutcome, true);
  assert.match(plan.message, /tardó más de lo esperado/);
});

test('a lost reply the server never got stays retryable', () => {
  const { engine, state } = playedRound1();
  const plan = planFailure(failure(504), false);
  const next = afterFailure(beginRequest(state, 'answers'), plan, engine.session(ID).session);
  assert.equal(next.latest.round, 1);
  assert.equal(next.retryable, true);
  assert.equal(next.uncertain, false, 'the session was read, so nothing is uncertain');
});

test('an unknown outcome with an unreadable session is marked uncertain', () => {
  const { state } = playedRound1();
  const next = afterFailure(beginRequest(state, 'answers'), planFailure(failure(0), false), undefined);
  assert.equal(next.uncertain, true);
  assert.equal(next.retryable, true);
});

test('a resend after a lost reply is replayed by the server, not refused', () => {
  const { engine, round1 } = playedRound1();
  const answers = allAnswers(round1);
  const first = engine.round({ diagnosisId: ID, mode: 'paciente', answers });
  const again = engine.round({ diagnosisId: ID, mode: 'paciente', answers });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, first.body);
});

test('a refused round is never retried; if the server moved on elsewhere, it is adopted and the reader told', () => {
  const { engine, state, round1 } = playedRound1();
  // Another tab answered differently.
  engine.round({ diagnosisId: ID, mode: 'paciente', answers: allAnswers(round1, 'no') });
  const mine = engine.round({ diagnosisId: ID, mode: 'paciente', answers: allAnswers(round1, 'si') });
  assert.equal(mine.status, 409, 'the other tab finished it');
  assert.equal(mine.body.code, 'finished');

  const plan = planFailure(failure(mine.status, mine.body.code), false);
  assert.equal(plan.retryable, false);
  assert.equal(plan.recover, true);
  const next = afterFailure(state, plan, engine.session(ID).session);
  assert.equal(next.phase, 'finished');
  assert.match(next.error, /otra pestaña o ventana/);
});

test('a 400 with nothing moved stays on the round, without a retry', () => {
  const { engine, state } = playedRound1();
  const next = afterFailure(state, planFailure(failure(400, 'answers_mismatch'), false), engine.session(ID).session);
  assert.equal(next.latest.round, 1);
  assert.equal(next.retryable, false);
  assert.match(next.error, /No pudimos procesar tus respuestas/);
});

test('no usable symptoms withdraws the way in and is not read back', () => {
  const plan = planFailure(failure(400, 'no_usable_symptoms'), false);
  assert.equal(plan.recover, false);
  assert.equal(plan.retryable, false);
  const next = afterFailure(beginRequest(INITIAL_STATE, 'start'), plan, undefined);
  assert.equal(next.blocked, true);
  assert.equal(next.phase, 'idle');
  assert.match(next.error, /No pudimos usar los síntomas de esta búsqueda/);
});

test('a 409 for a session finished elsewhere adopts how it ended', () => {
  const { engine, state } = playedRound1();
  engine.round({ diagnosisId: ID, mode: 'paciente', finish: true });
  const next = afterFailure(state, planFailure(failure(409, 'finished'), false), engine.session(ID).session);
  assert.equal(next.phase, 'finished');
  assert.match(next.error, /ya habían terminado/);
  assert.equal(next.retryable, false);
});

test('a 409 the session cannot explain is final, and says the result is intact', () => {
  const { state } = playedRound1();
  const next = afterFailure(state, planFailure(failure(409, 'conflict'), false), undefined);
  assert.equal(next.phase, 'questions');
  assert.equal(next.retryable, false);
  assert.match(next.error, /resultado no cambió/);
});

test('the in-flight 429 and the hourly limit are both retryable and never read back', () => {
  for (const code of ['round_in_flight', 'rate_limited', null]) {
    const plan = planFailure(failure(429, code, 10), false);
    assert.equal(plan.recover, false);
    assert.equal(plan.retryable, true);
  }
  assert.match(planFailure(failure(429, 'round_in_flight', 10), false).message, /otra pestaña o ventana/);
  assert.match(planFailure(failure(429, 'rate_limited', 10), false).message, /límite/);
});

test('each code is planned by what it means, not by the status it shares', () => {
  const plans = Object.fromEntries(
    [
      [400, 'invalid_request'], [400, 'answers_mismatch'], [400, 'no_usable_symptoms'], [404, 'not_found'],
      [409, 'finished'], [409, 'conflict'], [409, 'unreadable_session'], [429, 'rate_limited'],
      [429, 'global_limit'], [429, 'round_in_flight'], [500, 'internal'], [503, 'disabled'], [503, 'unavailable'],
      [504, 'timeout'],
    ].map(([status, code]) => [code, planFailure(failure(status, code), false)]),
  );
  const pick = (key) => Object.keys(plans).filter((code) => plans[code][key]).sort();
  assert.deepEqual(pick('blocked'), ['no_usable_symptoms']);
  assert.deepEqual(pick('recover'), ['answers_mismatch', 'conflict', 'finished', 'invalid_request', 'timeout', 'unreadable_session']);
  assert.deepEqual(pick('retryable'), [
    'disabled', 'global_limit', 'internal', 'rate_limited', 'round_in_flight', 'timeout', 'unavailable',
  ]);
  assert.deepEqual(pick('unknownOutcome'), ['timeout']);
});

test('without a code, the status stands in', () => {
  assert.equal(planFailure(failure(400), false).blocked, false, 'a bare 400 is not read as no usable symptoms');
  assert.equal(planFailure(failure(400), false).recover, true);
  assert.equal(planFailure(failure(504), false).unknownOutcome, true);
  assert.equal(planFailure(failure(502), false).retryable, true);
  assert.equal(planFailure(failure(502), false).recover, false);
});

test('an expired session is not retried from the panel', () => {
  for (const status of [401, 403, 404]) {
    const plan = planFailure(failure(status), false);
    assert.equal(plan.retryable, false, `status ${status}`);
    assert.equal(plan.recover, false, `status ${status}`);
  }
});

test('the server is ahead when it has a later round, a different status, or any session at all before we started', () => {
  const { engine, state, round1 } = playedRound1();
  assert.equal(serverMovedOn(state, engine.session(ID).session), false);
  assert.equal(serverMovedOn(INITIAL_STATE, engine.session(ID).session), true);
  assert.equal(serverMovedOn(state, null), false);

  engine.round({ diagnosisId: ID, mode: 'paciente', answers: allAnswers(round1) });
  assert.equal(serverMovedOn(state, engine.session(ID).session), true);
});

test('finishing after an uncertain request adopts the server first, so stale answers are never sent', () => {
  const { engine, state, round1 } = playedRound1();
  engine.round({ diagnosisId: ID, mode: 'paciente', answers: allAnswers(round1) });
  const uncertain = { ...state, uncertain: true };
  const reconciled = afterReconcile(uncertain, engine.session(ID).session);
  assert.notEqual(reconciled.latest, uncertain.latest);
  assert.equal(reconciled.uncertain, false);

  const same = afterReconcile(uncertain, playedRound1().engine.session(ID).session);
  assert.equal(same.latest, uncertain.latest);
  assert.equal(same.uncertain, false);
});

test('a resumed session keeps every round in the mode it was written in', () => {
  const engine = createQuestionsEngine(fixtures, { sequence: [fixtures.round1, fixtures.round1, fixtures.round2] });
  const r1 = engine.round({ diagnosisId: ID, mode: 'medico' }).body;
  engine.round({ diagnosisId: ID, mode: 'paciente', answers: allAnswers(r1) });
  const restored = fromSession(engine.session(ID).session);
  assert.deepEqual(restored.history.map((item) => item.mode), ['medico', 'medico', 'medico']);
  assert.equal(restored.latest.mode, 'paciente');
  assert.equal(restored.focusToken, 0, 'restoring is not something the reader did');
});

test('the latest answers remember the list they were measured against', () => {
  const engine = createQuestionsEngine(fixtures, { sequence: [fixtures.round1, fixtures.round1, fixtures.round2] });
  const r1 = engine.round({ diagnosisId: ID, mode: 'paciente' }).body;
  let state = afterStart(beginRequest(INITIAL_STATE, 'start'), r1);
  assert.equal(state.lastChange, null);

  // The first answers are measured against the model's own list.
  const first = allAnswers(r1);
  const r2 = engine.round({ diagnosisId: ID, mode: 'paciente', answers: first }).body;
  state = afterAnswers(state, r1, first, r2);
  assert.deepEqual(state.lastChange, { before: null, hpoIds: first.map((a) => a.hpoId) });

  // Later ones against the refined list that was on screen.
  const second = allAnswers(r2, 'no');
  const r3 = engine.round({ diagnosisId: ID, mode: 'paciente', answers: second }).body;
  const next = afterAnswers(state, r2, second, r3);
  assert.equal(next.lastChange.before, r2.ranking);
  assert.equal(fromSession(engine.session(ID).session).lastChange, null, 'unknown after a reload');
});

test('the hourly limit holds the retry back for as long as it says, and nothing else does', () => {
  const { state } = playedRound1();
  const limited = afterFailure(beginRequest(state, 'answers'), planFailure(failure(429, 'rate_limited', 1800), false), undefined);
  assert.equal(limited.retryable, true);
  assert.equal(limited.retryHold, 1800);
  assert.equal(planFailure(failure(429, null, null), false).hold, RATE_LIMIT_HOLD_SECONDS, 'a proxy 429 is the limit too');
  for (const [status, code] of [[429, 'round_in_flight'], [503, 'unavailable'], [504, 'timeout']]) {
    assert.equal(planFailure(failure(status, code, 10), false).hold, null, code);
  }
  assert.equal(beginRequest(limited, 'answers').retryHold, null);
});

test('the platform-wide cap holds the retry back like the hourly limit, and is read back never', () => {
  const { state } = playedRound1();
  const plan = planFailure(failure(429, 'global_limit', 7200), false);
  assert.equal(plan.recover, false);
  assert.equal(plan.blocked, false);
  assert.equal(plan.hold, 7200);
  const capped = afterFailure(beginRequest(state, 'answers'), plan, undefined);
  assert.equal(capped.phase, 'questions', 'the round on screen stays, answers and all');
  assert.equal(capped.retryable, true);
  assert.equal(capped.retryHold, 7200);
  assert.match(capped.error, /llegó al máximo de preguntas/);
  assert.equal(planFailure(failure(429, 'global_limit', null), false).hold, RATE_LIMIT_HOLD_SECONDS);
});
