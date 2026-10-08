import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importTs } from './helpers/ts-module.mjs';

/**
 * What the answers did to the list, and the sheet for the consultation.
 *
 * The rules under test: a move is a place in a list and never a likelihood,
 * an answer is credited with a move only when its question said so, and the
 * family's copy of the summary carries the disclaimer and no clinical
 * attribution.
 */

const {
  describeMove,
  rankMovement,
  originsIn,
  listChanges,
  droppedSentence,
  associatedGenes,
  groupAnswers,
  buildConsultText,
  sessionChanges,
  ADJUSTED_LIST_NOTE,
  RERANK_NOTE,
  MOVED_NOTE,
} = await importTs('lib/questions-api.ts', 'lib/onset.ts', 'lib/question-insights.ts');
const { RESULTS_DISCLAIMER } = await importTs('lib/disclaimer.ts');

const fixtures = JSON.parse(readFileSync(new URL('../mocks/fixtures.json', import.meta.url), 'utf8')).questions;
const [STOOL, SITUS, SWEAT] = fixtures.round1.questions;

const answered = (question, answer, note = null, effectiveAnswer = answer) => ({
  question, mode: 'medico', answer, note, effectiveAnswer,
});
const row = (symbol, modelRank) => ({ geneId: symbol, geneSymbol: symbol, score: 0.1, modelRank });

test('a move reads as a place in the list, with a whole sentence for screen readers', () => {
  assert.deepEqual(describeMove(3, 2), {
    text: '↑ 3.º → 2.º', label: 'Subió del puesto 3 al 2 con tus respuestas.', direction: 'up',
  });
  assert.deepEqual(describeMove(2, 3), {
    text: '↓ 2.º → 3.º', label: 'Bajó del puesto 2 al 3 con tus respuestas.', direction: 'down',
  });
  assert.deepEqual(describeMove(1, 1), { text: '= 1.º', label: 'Sigue en el puesto 1.', direction: 'same' });
  for (const [from, to] of [[4, 1], [1, 4], [2, 2]]) {
    const { text, label } = describeMove(from, to);
    assert.doesNotMatch(`${text} ${label}`, /probab|\d\.\d|%/);
  }
});

test('a gene the earlier list did not have reads as new, entering at its place', () => {
  assert.deepEqual(describeMove(null, 4), {
    text: 'nuevo', label: 'Entra en la lista con tus respuestas, en el puesto 4.', direction: 'new',
  });
});

test('a card moves from its place in the list shown before the questions, and says rank 1 is not an answer', () => {
  const movement = rankMovement(2, 5);
  assert.equal(movement.text, '↑ 5.º → 2.º');
  assert.match(movement.title, /lista que viste antes de las preguntas/);
  assert.match(movement.title, /no quiere decir que sea la respuesta/);
  assert.equal(rankMovement(1, 1).text, '= 1.º');
  assert.equal(rankMovement(3, null).text, 'nuevo');
  assert.match(rankMovement(3, null).title, /No estaba en la lista/);
});

test('each gene of the new list is placed in the old one by symbol, or not at all', () => {
  const origins = originsIn(['CFTR', 'DNAH5', 'SCNN1A'], ['cftr', 'DNAI1', 'SCNN1A']);
  assert.deepEqual([...origins], [['CFTR', 1], ['DNAI1', null], ['SCNN1A', 3]]);
});

test('the diff between two lists: up, down, same, new and dropped', () => {
  const before = ['CFTR', 'DNAH5', 'SCNN1A', 'DNAI1', 'CCDC40'];
  const after = ['CFTR', 'SCNN1A', 'NEW1', 'DNAH5', 'CCDC40'];
  const result = listChanges(before, after);
  const byGene = Object.fromEntries(result.moves.map((m) => [m.symbol, [m.from, m.to]]));
  assert.deepEqual(byGene, { SCNN1A: [3, 2], NEW1: [null, 3], DNAH5: [2, 4] });
  // Same place: not a move, and the steady first gene is named apart.
  assert.equal('CCDC40' in byGene, false);
  assert.deepEqual(result.steadyTop, { symbol: 'CFTR', from: 1, to: 1 });
  assert.equal(result.movedCount, 3);
  // Fell out of the new list's length: DNAI1 was 4th in a list of 5.
  assert.deepEqual(result.dropped, ['DNAI1']);
  // A new gene near the top outranks a one-place shuffle.
  assert.equal(result.moves[0].symbol, 'NEW1');
});

test('a shorter new list leaving out the old tail drops nothing worth saying', () => {
  const result = listChanges(['A', 'B', 'C', 'D', 'E'], ['B', 'A']);
  assert.deepEqual(result.dropped, []);
  assert.deepEqual(result.moves.map((m) => [m.symbol, m.from, m.to]), [['B', 2, 1], ['A', 1, 2]]);
  assert.equal(droppedSentence([]), null);
  assert.equal(droppedSentence(['DNAH5', 'SCNN1A']), 'Quedaron fuera de esta lista: DNAH5 y SCNN1A.');
  assert.equal(droppedSentence(['A', 'B', 'C', 'D']), '4 genes de la lista anterior quedaron fuera de esta.');
});

test('the changes list the biggest moves first, at most four, and the steady first gene', () => {
  const result = listChanges(['A', 'B', 'C', 'D', 'E', 'F', 'G'], ['A', 'G', 'C', 'B', 'F', 'E', 'D']);
  assert.deepEqual(result.moves.map((m) => [m.symbol, m.from, m.to]), [
    ['G', 7, 2], ['D', 4, 7], ['B', 2, 4], ['F', 6, 5],
  ]);
  assert.equal(result.movedCount, 5);
  assert.deepEqual(result.steadyTop, { symbol: 'A', from: 1, to: 1 });
});

test('a new first gene is a move, not a steady one', () => {
  const result = listChanges(['cftr', 'DNAH5'], ['DNAH5', 'CFTR', 'NEW1']);
  assert.equal(result.steadyTop, null);
  assert.deepEqual(result.moves.map((m) => [m.symbol, m.from]), [['DNAH5', 2], ['CFTR', 1], ['NEW1', null]]);
  assert.equal(listChanges(['A', 'B'], ['A', 'B']).movedCount, 0);
});

test('only a «Sí» has genes against it: a «No» or a «No sé» reaches no list', () => {
  assert.deepEqual(associatedGenes(answered(STOOL, 'si')), ['CFTR']);
  assert.deepEqual(associatedGenes(answered(STOOL, 'no')), []);
  assert.deepEqual(associatedGenes(answered(STOOL, 'no_se')), []);
  // Read by its note, a «No sé» that says yes is a «Sí».
  assert.deepEqual(associatedGenes(answered(STOOL, 'no_se', 'sí, desde bebé', 'si')), ['CFTR']);
  // Even a round saved when the agent still named genes against a «No».
  const legacy = { ...answered(STOOL, 'no'), question: { ...STOOL, genesIfNo: ['DNAH5'] } };
  assert.deepEqual(associatedGenes(legacy), []);
  const family = { ...answered(STOOL, 'si'), question: { ...STOOL, genesIfYes: null, genesIfNo: null } };
  assert.deepEqual(associatedGenes(family), []);
});

test('the list with the answers is described as the model ranking again, crediting no answer', () => {
  assert.equal(RERANK_NOTE, 'El modelo volvió a ordenar la lista con los síntomas que confirmaste.');
  assert.match(MOVED_NOTE, /el modelo volvió a ordenar la lista con los síntomas que confirmaste/);
  for (const text of [RERANK_NOTE, MOVED_NOTE]) assert.doesNotMatch(text, /por (Sí|No) a|tus respuestas:/);
});

test('answers are grouped by how they were read, not by the button', () => {
  const groups = groupAnswers([
    answered(STOOL, 'no_se', 'sí', 'si'), answered(SITUS, 'no'), answered(SWEAT, 'no_se'),
  ]);
  assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.map((i) => i.question.hpoId)])), {
    si: [STOOL.hpoId], no: [SITUS.hpoId], no_se: [SWEAT.hpoId],
  });
});

function sheet(overrides = {}) {
  const history = [answered(STOOL, 'si', 'desde bebé'), answered(SITUS, 'no'), answered(SWEAT, 'no_se')];
  return {
    title: 'Para conversar en la consulta',
    summary: 'Resumen de prueba.',
    finishNote: 'El primer gen de la lista ya se destacaba claramente sobre los demás, así que no hacían falta más preguntas.',
    changes: {
      caption: 'Respecto de la lista original',
      result: listChanges(['CFTR', 'DNAH5', 'SCNN1A'], ['CFTR', 'SCNN1A', 'DNAH5']),
    },
    history,
    professional: false,
    genes: ['CFTR', 'DNAH5', 'SCNN1A'],
    adjustedGenes: null,
    disclaimer: RESULTS_DISCLAIMER,
    date: new Date(2026, 8, 28, 12),
    ...overrides,
  };
}

test('the family copy has the summary, the answers by label, the list and the disclaimer word for word', () => {
  const text = buildConsultText(sheet());
  assert.ok(text.startsWith('Para conversar en la consulta\nDiagnostic.ar · 28 de septiembre de 2026'));
  assert.match(text, /Resumen de prueba\.\nEl primer gen de la lista ya se destacaba/);
  assert.match(text, /Qué cambió con tus respuestas \(respecto de la lista original\):\nEl modelo volvió a ordenar la lista con los síntomas que confirmaste\.\n/);
  assert.match(text, /- SCNN1A subió del puesto 3 al 2\./);
  assert.match(text, /- DNAH5 bajó del puesto 2 al 3\./);
  assert.match(text, /- CFTR sigue en el puesto 1\./);
  assert.match(text, /Dijiste que sí: Insuficiencia pancreática exocrina \(«desde bebé»\)\./);
  assert.match(text, /Dijiste que no: Situs inversus totalis\./);
  assert.match(text, /No sabías: Cloruro en sudor elevado\./);
  assert.match(text, /en el orden original del modelo[^\n]*\n1\. CFTR · 2\. DNAH5 · 3\. SCNN1A/);
  assert.doesNotMatch(text, /Orden con tus respuestas/, 'the adjusted order only when the reader chose it');
  assert.ok(text.endsWith(RESULTS_DISCLAIMER));
  // No clinical attribution, no HPO ids, no question wording.
  assert.doesNotMatch(text, /por (Sí|No) a|HP:\d|Favorece/);
  assert.ok(!text.includes(STOOL.text));
});

test('the order adjusted by the answers follows the model\'s list, labelled as still under evaluation, when chosen', () => {
  const text = buildConsultText(sheet({ adjustedGenes: ['CFTR', 'SCNN1A', 'DNAH5'] }));
  const original = text.indexOf('1. CFTR · 2. DNAH5 · 3. SCNN1A');
  const adjusted = text.indexOf('1. CFTR · 2. SCNN1A · 3. DNAH5');
  assert.ok(original > 0 && adjusted > original, 'the model\'s list first, the adjusted one after it');
  assert.match(text, /Orden con tus respuestas\. La lista con tus respuestas es orientativa: todavía estamos evaluando si mejora el orden\.\n1\. CFTR · 2\. SCNN1A/);
  assert.equal(ADJUSTED_LIST_NOTE, 'La lista con tus respuestas es orientativa: todavía estamos evaluando si mejora el orden.');
  assert.ok(text.endsWith(RESULTS_DISCLAIMER));
});

test('the medical copy lists each answer by HPO id, the genes a «Sí» is associated with, and the moves without crediting any answer', () => {
  const text = buildConsultText(sheet({ professional: true }));
  assert.match(text, /- HP:0001738 Insuficiencia pancreática exocrina: Sí\. Nota: «desde bebé»\. Asociado a: CFTR\./);
  assert.match(text, /- HP:0001696 Situs inversus totalis: No\.$/m);
  assert.match(text, /- HP:0012236 Cloruro en sudor elevado: No sé\.$/m);
  assert.match(text, /- DNAH5 bajó del puesto 2 al 3\.$/m);
  assert.doesNotMatch(text, /por (Sí|No) a|Favorece/);
  assert.ok(text.endsWith(RESULTS_DISCLAIMER));
});

test('with nothing answered the copy is the summary, the list and the disclaimer', () => {
  const text = buildConsultText(sheet({ history: [], changes: null, finishNote: null }));
  assert.doesNotMatch(text, /Lo que respondiste|Qué cambió/);
  assert.match(text, /Genes sugeridos/);
  assert.ok(text.endsWith(RESULTS_DISCLAIMER));
});

test('a round measures its own answers against the list before them; the session against the list shown first', () => {
  // As the agent now sends them: modelRank is each gene's place in the
  // re-ranked list itself, and must not be read as where it came from.
  const ORIGINAL = ['CFTR', 'DNAH5', 'SCNN1A'];
  const r2 = [row('CFTR', 1), row('SCNN1A', 2), row('DNAH5', 3)];
  const r3 = [row('SCNN1A', 1), row('CFTR', 2), row('DNAH5', 3)];
  const first = [answered(STOOL, 'no'), answered(SITUS, 'no'), answered(SWEAT, 'no_se')];
  const later = { question: { ...STOOL, hpoId: 'HP:0002153', label: 'Hiperpotasemia', genesIfYes: ['SCNN1A'], genesIfNo: [] }, mode: 'medico', answer: 'si', note: null, effectiveAnswer: 'si' };

  assert.equal(sessionChanges({ refined: null, history: [], lastChange: null }, 'round', ORIGINAL), null);

  // First answers: against the list shown before the questions.
  const one = sessionChanges({ refined: { ranking: r2 }, history: first, lastChange: { before: null, hpoIds: first.map((i) => i.question.hpoId) } }, 'round', ORIGINAL);
  assert.equal(one.caption, 'Respecto de la lista original');
  assert.deepEqual(one.result.moves.map((m) => [m.symbol, m.from, m.to]), [['SCNN1A', 3, 2], ['DNAH5', 2, 3]]);
  assert.equal('causes' in one, false, 'no move is credited to an answer');

  // Later answers: against the list with the answers as it stood before them.
  const history = [...first, later];
  const two = sessionChanges({ refined: { ranking: r3 }, history, lastChange: { before: r2, hpoIds: ['HP:0002153'] } }, 'round', ORIGINAL);
  assert.equal(two.caption, 'Respecto de la lista anterior');
  assert.deepEqual(two.result.moves.map((m) => [m.symbol, m.from, m.to]), [['SCNN1A', 2, 1], ['CFTR', 1, 2]]);
  assert.equal(two.result.steadyTop, null);

  // The session view of the same moment compares with the list shown first.
  const all = sessionChanges({ refined: { ranking: r3 }, history, lastChange: { before: r2, hpoIds: ['HP:0002153'] } }, 'session', ORIGINAL);
  assert.equal(all.caption, 'Respecto de la lista original');
  assert.deepEqual(all.result.moves.map((m) => [m.symbol, m.from, m.to]), [['SCNN1A', 3, 1], ['CFTR', 1, 2], ['DNAH5', 2, 3]]);

  // After a reload nothing says what came before, so a round says it compares with the original.
  assert.equal(sessionChanges({ refined: { ranking: r3 }, history, lastChange: null }, 'round', ORIGINAL).caption, 'Respecto de la lista original');

  // A gene the list shown first did not have enters as new; one that left is named.
  const entered = sessionChanges({ refined: { ranking: [row('CFTR', 1), row('DNAI1', 2), row('SCNN1A', 3)] }, history: first, lastChange: null }, 'session', ORIGINAL);
  assert.deepEqual(entered.result.moves.map((m) => [m.symbol, m.from, m.to]), [['DNAI1', null, 2]]);
  assert.deepEqual(entered.result.dropped, ['DNAH5']);
});

test('the copied summary carries the onset the patient reported, only when there is one', () => {
  const none = buildConsultText(sheet({ symptoms: [{ label: 'Tos' }] }));
  assert.doesNotMatch(none, /Inicio de los síntomas/);
  const text = buildConsultText(
    sheet({ symptoms: [{ label: 'Tos' }, { label: 'Convulsiones', onset: { hpo_id: 'HP:0011463', age_years: null } }] }),
  );
  assert.match(text, /Síntomas informados:\nInicio de los síntomas: entre 1 y 5 años \(Convulsiones\)\n- Convulsiones · empezó entre 1 y 5 años\nDato clínico informado por el paciente; no modifica el orden de genes\./);
});
