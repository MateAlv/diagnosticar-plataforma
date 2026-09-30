import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/**
 * Unit tests for the question agent client and the rules the panel runs on.
 *
 * The rule under test throughout: the loop is optional on top of a result
 * that already exists, so no failure may throw, and nothing half-answered is
 * ever sent as if it were complete.
 */

const source = readFileSync(new URL('../src/lib/questions-api.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

const EXPORTS = [
  'fetchQuestionsStatus', 'postQuestionRound', 'fetchQuestionSession', 'roundErrorMessage',
  'toGeneRows', 'canSubmitRound', 'buildAnswers', 'mergeAnswered', 'historyFromSession',
  'answeredFindings', 'answerLabel', 'describeWarning', 'isSimpleMode', 'questionWording', 'humanizeWait',
  'failureCode', 'MAX_NOTE_LENGTH', 'NO_SYMPTOMS_MESSAGE',
];

function load(fetchImpl = () => Promise.reject(new Error('no fetch'))) {
  const body = js.replace(/^export /gm, '').replace(/"use client";?/, '');
  return new Function('fetch', 'process', `${body}; return { ${EXPORTS.join(', ')} };`)(
    fetchImpl,
    { env: { NEXT_PUBLIC_API_URL: 'http://api.test' } },
  );
}

const q = (hpoId, text = `¿${hpoId}?`) => ({
  id: `r1-${hpoId}`, hpoId, label: `Etiqueta ${hpoId}`, text, help: null, genesIfYes: null, genesIfNo: null, rationale: null,
});
const QUESTIONS = [q('HP:0001738'), q('HP:0001696'), q('HP:0012236')];
const ROUND = { mode: 'paciente', questions: QUESTIONS };

const response = (status, body, headers = {}) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: () => Promise.resolve(body),
  });

test('a round cannot be sent until every question has an answer', () => {
  const { canSubmitRound } = load();
  const drafts = {
    'r1-HP:0001738': { answer: 'si', note: '' },
    'r1-HP:0001696': { answer: 'no', note: '' },
  };
  assert.equal(canSubmitRound(QUESTIONS, drafts), false);

  drafts['r1-HP:0012236'] = { answer: 'no_se', note: '' };
  assert.equal(canSubmitRound(QUESTIONS, drafts), true);
});

test('a note over the limit blocks the round rather than being cut silently', () => {
  const { canSubmitRound, MAX_NOTE_LENGTH } = load();
  const drafts = Object.fromEntries(QUESTIONS.map((item) => [item.id, { answer: 'si', note: '' }]));
  drafts['r1-HP:0001738'].note = 'x'.repeat(MAX_NOTE_LENGTH + 1);
  assert.equal(canSubmitRound(QUESTIONS, drafts), false);
});

test('an empty round is never ready', () => {
  const { canSubmitRound } = load();
  assert.equal(canSubmitRound([], {}), false);
});

test('answers go out in question order, with blank notes left out', () => {
  const { buildAnswers } = load();
  const answers = buildAnswers(QUESTIONS, {
    'r1-HP:0012236': { answer: 'no_se', note: '   ' },
    'r1-HP:0001738': { answer: 'si', note: '  desde bebé ' },
    'r1-HP:0001696': { answer: 'no', note: '' },
  });
  assert.deepEqual(answers, [
    { hpoId: 'HP:0001738', answer: 'si', note: 'desde bebé' },
    { hpoId: 'HP:0001696', answer: 'no' },
    { hpoId: 'HP:0012236', answer: 'no_se' },
  ]);
});

test('a refined ranking takes the grid shape, with the match fields zeroed', () => {
  const { toGeneRows } = load();
  const rows = toGeneRows([{ geneId: 'CFTR', geneSymbol: 'CFTR', score: 0.81, modelRank: 1 }], 2);
  assert.deepEqual(rows, [{
    gene_id: 'CFTR', gene_symbol: 'CFTR', score: 0.81,
    matched_hpo_ids: [], matched_count: 0, input_count: 2, coverage: 0, precision: 0,
  }]);
});

test('the agent reading of an answer wins over the button', () => {
  // "No sé" with the note "sí, desde bebé" is a yes, and the chips follow it.
  const { mergeAnswered, answeredFindings } = load();
  const history = mergeAnswered([], ROUND,
    [{ hpoId: 'HP:0001738', answer: 'no_se', note: 'sí, desde bebé' }, { hpoId: 'HP:0001696', answer: 'no' }],
    [{ hpoId: 'HP:0001738', answer: 'no_se', effectiveAnswer: 'si', noteSummary: 'Desde bebé.' }],
  );
  assert.equal(history[0].effectiveAnswer, 'si');
  assert.equal(history[0].answer, 'no_se');
  assert.equal(history[1].effectiveAnswer, 'no');

  const { present, absent } = answeredFindings(history);
  assert.deepEqual(present.map((item) => item.question.hpoId), ['HP:0001738']);
  assert.deepEqual(absent.map((item) => item.question.hpoId), ['HP:0001696']);
});

test('a later reading of an earlier answer is applied too', () => {
  // interpretedAnswers covers every round, so round 2's reply can revise round 1.
  const { mergeAnswered } = load();
  let history = mergeAnswered([], ROUND, [{ hpoId: 'HP:0001738', answer: 'no_se', note: 'sí' }], []);
  history = mergeAnswered(history, { mode: 'paciente', questions: [q('HP:0002570')] },
    [{ hpoId: 'HP:0002570', answer: 'no' }],
    [
      { hpoId: 'HP:0001738', answer: 'no_se', effectiveAnswer: 'si', noteSummary: null },
      { hpoId: 'HP:0002570', answer: 'no', effectiveAnswer: 'no', noteSummary: null },
    ],
  );
  assert.deepEqual(history.map((item) => [item.question.hpoId, item.effectiveAnswer]), [
    ['HP:0001738', 'si'], ['HP:0002570', 'no'],
  ]);
});

test('each answered question remembers the mode it was written in', () => {
  const { mergeAnswered } = load();
  const history = mergeAnswered([], { mode: 'medico', questions: QUESTIONS }, [{ hpoId: 'HP:0001738', answer: 'si' }], []);
  assert.equal(history[0].mode, 'medico');
  assert.deepEqual(Object.keys(history[0]).sort(), ['answer', 'effectiveAnswer', 'mode', 'note', 'question']);
});

test('answering a phenotype again replaces the earlier answer', () => {
  const { mergeAnswered } = load();
  let history = mergeAnswered([], ROUND, [{ hpoId: 'HP:0001738', answer: 'no' }], []);
  history = mergeAnswered(history, ROUND, [{ hpoId: 'HP:0001738', answer: 'si' }], []);
  assert.equal(history.length, 1);
  assert.equal(history[0].answer, 'si');
});

test('a saved session rebuilds its history from the answered rounds, each in its own mode', () => {
  const { historyFromSession } = load();
  const history = historyFromSession({
    finished: false,
    rounds: [
      { round: 1, mode: 'medico', questions: QUESTIONS, answers: [{ hpoId: 'HP:0012236', answer: 'si', note: null }] },
      { round: 2, mode: 'paciente', questions: [q('HP:0002570')], answers: [] },
    ],
    latest: { interpretedAnswers: [] },
  });
  assert.deepEqual(history.map((item) => [item.question.hpoId, item.answer, item.mode]), [['HP:0012236', 'si', 'medico']]);
  assert.equal(history[0].note, null);
});

test('a finished session, in the shape the backend stores it, names each finding by its HPO label', () => {
  // The backend appends the round that closed the session, with no questions,
  // and stores a blank note as null.
  const { historyFromSession, answeredFindings } = load();
  const history = historyFromSession({
    finished: true,
    rounds: [
      {
        round: 1,
        mode: 'paciente',
        questions: QUESTIONS,
        answers: [
          { hpoId: 'HP:0001738', answer: 'si', note: 'desde bebé' },
          { hpoId: 'HP:0001696', answer: 'no', note: null },
          { hpoId: 'HP:0012236', answer: 'no_se', note: null },
        ],
      },
      { round: 2, mode: 'paciente', questions: [], answers: [] },
    ],
    latest: {
      interpretedAnswers: [
        { hpoId: 'HP:0001738', answer: 'si', effectiveAnswer: 'si', noteSummary: 'Desde bebé.' },
      ],
    },
  });
  assert.equal(history.length, 3);
  const { present, absent } = answeredFindings(history);
  assert.deepEqual(present.map((item) => item.question.label), ['Etiqueta HP:0001738']);
  assert.deepEqual(absent.map((item) => item.question.label), ['Etiqueta HP:0001696']);
  assert.equal(present[0].note, 'desde bebé');
});

test('a question written for the medical view is never shown as written in the family view', () => {
  const { questionWording } = load();
  const question = {
    ...q('HP:0012236', '¿Test del sudor con cloruro ≥ 60 mmol/L? Sube CFTR.'),
    label: 'Cloruro en sudor elevado',
    help: 'Relevante para CFTR.',
  };
  const family = questionWording(question, 'medico', false);
  assert.equal(family.neutral, true);
  assert.match(family.text, /«Cloruro en sudor elevado»/);
  assert.doesNotMatch(`${family.text} ${family.help}`, /CFTR|mmol/);

  assert.equal(questionWording(question, 'medico', true).text, question.text);
  // A family-worded question is safe in either view.
  const plain = q('HP:0001738', '¿Notaste algo?');
  assert.equal(questionWording(plain, 'paciente', false).text, '¿Notaste algo?');
  assert.equal(questionWording(plain, 'paciente', true).text, '¿Notaste algo?');
});

test('every failure says the result did not change, in our own words', () => {
  const { roundErrorMessage } = load();
  for (const status of [0, 400, 404, 409, 429, 503, 504, 500]) {
    assert.match(roundErrorMessage(status), /resultado no cambió/, `status ${status}`);
  }
});

test('the wait is said in words, not seconds', () => {
  const { humanizeWait, roundErrorMessage } = load();
  assert.equal(humanizeWait(null), 'en un rato');
  assert.equal(humanizeWait(10), 'en unos segundos');
  assert.equal(humanizeWait(45), 'en un minuto');
  assert.equal(humanizeWait(300), 'en 5 minutos');
  assert.equal(humanizeWait(3540), 'en alrededor de una hora');
  assert.equal(humanizeWait(4800), 'en alrededor de una hora');
  assert.equal(humanizeWait(7200), 'en unas 2 horas');
  assert.equal(humanizeWait(18_000), 'en unas 5 horas');
  assert.doesNotMatch(roundErrorMessage(429, 1800), /segundos/);
  assert.match(roundErrorMessage(429, 1800), /en 30 minutos/);
});

test('every code the backend sends has its own message', () => {
  const { roundErrorMessage } = load();
  const codes = {
    invalid_request: 400, answers_mismatch: 400, no_usable_symptoms: 400, not_found: 404, finished: 409,
    conflict: 409, unreadable_session: 409, rate_limited: 429, global_limit: 429, round_in_flight: 429,
    internal: 500, disabled: 503, unavailable: 503, timeout: 504,
  };
  for (const [code, status] of Object.entries(codes)) {
    assert.match(roundErrorMessage(status, null, code), /resultado no cambió/, code);
  }
});

test('a round running elsewhere is told apart from the hourly limit by its code', () => {
  const { roundErrorMessage } = load();
  assert.match(roundErrorMessage(429, 10, 'round_in_flight'), /Ya hay una ronda en curso en otra pestaña o ventana/);
  assert.match(roundErrorMessage(429, 1800, 'rate_limited'), /límite/);
  assert.doesNotMatch(roundErrorMessage(429, 1800, 'rate_limited'), /en curso/);
  assert.match(roundErrorMessage(429, 1800, null), /límite/, 'a 429 without a code is read as the limit');
});

test('the platform-wide cap is not blamed on the reader, and says when to come back', () => {
  const { roundErrorMessage } = load();
  const message = roundErrorMessage(429, 7200, 'global_limit');
  assert.match(message, /^Diagnostic\.ar llegó al máximo de preguntas por ahora\./);
  assert.match(message, /Tu resultado no cambió/);
  assert.match(message, /en unas 2 horas/);
  assert.doesNotMatch(message, /Llegaste|límite/);
});

test('a search with no usable symptoms says so, not that the answers were wrong', () => {
  const { roundErrorMessage, NO_SYMPTOMS_MESSAGE } = load();
  assert.ok(roundErrorMessage(400, null, 'no_usable_symptoms').startsWith(NO_SYMPTOMS_MESSAGE));
  assert.match(roundErrorMessage(400, null, 'answers_mismatch'), /No pudimos procesar tus respuestas/);
  assert.match(roundErrorMessage(400), /No pudimos procesar tus respuestas/);
});

test('the code decides, and the status stands in only when there is none', () => {
  const { failureCode } = load();
  assert.equal(failureCode({ status: 503, code: 'disabled' }), 'disabled');
  assert.equal(failureCode({ status: 400, code: 'no_usable_symptoms' }), 'no_usable_symptoms');
  assert.equal(failureCode({ status: 400, code: null }), 'invalid_request');
  assert.equal(failureCode({ status: 429, code: null }), 'rate_limited');
  assert.equal(failureCode({ status: 504, code: null }), 'timeout');
  assert.equal(failureCode({ status: 502, code: null }), null);
  assert.equal(failureCode({ status: 0, code: null }), null);
});

test('status is off unless the server clearly says it is on', async () => {
  const cases = [
    [() => response(200, { enabled: true }), true],
    [() => response(200, { enabled: 'true' }), false],
    [() => response(404, { error: 'Not found' }), false],
    [() => Promise.reject(new TypeError('network')), false],
  ];
  for (const [impl, expected] of cases) {
    assert.equal(await load(impl).fetchQuestionsStatus(), expected);
  }
});

test('a round posts to the rounds route with credentials and the body as given', async () => {
  const calls = [];
  const { postQuestionRound } = load((url, init) => {
    calls.push({ url, init });
    return response(200, { round: 1 });
  });

  const result = await postQuestionRound({ diagnosisId: 'd', mode: 'medico' });

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'http://api.test/questions/rounds');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'include');
  assert.deepEqual(JSON.parse(calls[0].init.body), { diagnosisId: 'd', mode: 'medico' });
});

test('a failed round resolves to a status and a code, never a throw', async () => {
  const limited = await load(() =>
    response(429, { error: 'Hiciste muchas consultas seguidas.', code: 'rate_limited' }, { 'Retry-After': '12' }),
  ).postQuestionRound({});
  assert.deepEqual(limited, { ok: false, status: 429, code: 'rate_limited', retryAfterSeconds: 12 });

  const busy = await load(() =>
    response(429, { error: 'Cualquier texto.', code: 'round_in_flight' }, { 'Retry-After': '10' }),
  ).postQuestionRound({});
  assert.equal(busy.code, 'round_in_flight');

  const { NO_SYMPTOMS_MESSAGE } = load();
  const empty = await load(() => response(400, { error: 'Otro texto.', code: 'no_usable_symptoms' })).postQuestionRound({});
  assert.equal(empty.code, 'no_usable_symptoms');
  const wordingOnly = await load(() => response(400, { error: NO_SYMPTOMS_MESSAGE })).postQuestionRound({});
  assert.equal(wordingOnly.code, null, 'the wording alone must not decide the failure');
  const inFlightWording = await load(() => response(429, { error: 'Ya hay una ronda en curso.' })).postQuestionRound({});
  assert.equal(inFlightWording.code, null);
  const unknown = await load(() => response(409, { error: 'x', code: 'something_new' })).postQuestionRound({});
  assert.equal(unknown.code, null);

  const unreadable = await load(() =>
    Promise.resolve({ ok: false, status: 503, headers: { get: () => null }, json: () => Promise.reject(new SyntaxError('x')) }),
  ).postQuestionRound({});
  assert.deepEqual(unreadable, { ok: false, status: 503, code: null, retryAfterSeconds: null });

  const offline = await load(() => Promise.reject(new TypeError('network'))).postQuestionRound({});
  assert.deepEqual([offline.ok, offline.status], [false, 0]);
});

test('a session read tells "there is none" apart from "could not read it"', async () => {
  assert.deepEqual(await load(() => response(200, { session: null })).fetchQuestionSession('d'), { ok: true, session: null });
  assert.deepEqual(await load(() => response(404, {})).fetchQuestionSession('d'), { ok: false });
  assert.deepEqual(await load(() => Promise.reject(new Error('x'))).fetchQuestionSession('d'), { ok: false });
  const found = await load(() => response(200, { session: { finished: true, rounds: [], latest: {} } })).fetchQuestionSession('d');
  assert.equal(found.ok, true);
  assert.equal(found.session.finished, true);
});

test('a bare warning code never reaches the reader', () => {
  const { describeWarning } = load();
  assert.equal(describeWarning('llm_fallback'), 'Algunas preguntas se generaron sin IA.');
  assert.equal(describeWarning('Una ronda se armó sin conexión.'), 'Una ronda se armó sin conexión.');
});

test('answers are labelled in Spanish', () => {
  const { answerLabel } = load();
  assert.deepEqual(['si', 'no', 'no_se'].map(answerLabel), ['Sí', 'No', 'No sé']);
});

test('a round written from templates is simple mode; a notes warning is not', () => {
  const { isSimpleMode } = load();
  assert.equal(isSimpleMode(['Algunas preguntas se generaron sin IA.']), true);
  assert.equal(isSimpleMode(['El resumen se generó sin IA.']), true);
  assert.equal(isSimpleMode(['No pudimos interpretar las notas; se usaron las respuestas tal como se marcaron.']), false);
  assert.equal(isSimpleMode([]), false);
  assert.equal(isSimpleMode(undefined), false);
});
