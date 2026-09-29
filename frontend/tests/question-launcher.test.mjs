import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importTs } from './helpers/ts-module.mjs';

/**
 * The launcher's four states while the question panel is hidden: not
 * started, questions waiting, a round being prepared (and then ready), and
 * finished. The rule under test beyond the wording: a round that arrives
 * while the panel is hidden is announced, never forced on screen.
 */

const { launcherState, LAUNCHER_ERROR_DETAIL } = await importTs('lib/questions-api.ts', 'lib/question-launcher.ts');

const fixtures = JSON.parse(readFileSync(new URL('../mocks/fixtures.json', import.meta.url), 'utf8')).questions;

const session = (patch = {}) => ({ phase: 'idle', pending: null, latest: null, error: null, ...patch });
const inRound = (round, patch = {}) =>
  session({ phase: 'questions', latest: { ...fixtures.round1, round }, ...patch });

test('before anything is asked it invites, and says what a round costs', () => {
  assert.deepEqual(launcherState(session(), false), {
    kind: 'start', label: 'Afinar la lista', detail: '3 preguntas por ronda', round: null,
  });
});

test('with questions waiting it says which round, out of three', () => {
  assert.deepEqual(launcherState(inRound(2), false), {
    kind: 'continue', label: 'Seguir con las preguntas', detail: 'Ronda 2 de 3', round: 2,
  });
});

test('while a round is being prepared it says so, whatever phase it came from', () => {
  for (const state of [session({ pending: 'start' }), inRound(1, { pending: 'answers' })]) {
    const launcher = launcherState(state, false);
    assert.equal(launcher.kind, 'preparing');
    assert.equal(launcher.label, 'Preparando preguntas…');
    assert.equal(launcher.round, null, 'no progress is shown for a round that is not here yet');
  }
  assert.equal(launcherState(inRound(1, { pending: 'finish' }), false).label, 'Armando el resumen…');
});

test('a round that arrived out of sight is announced as ready until it is seen', () => {
  const ready = launcherState(inRound(2), true);
  assert.deepEqual(ready, { kind: 'ready', label: 'Preguntas listas', detail: 'Ronda 2 de 3', round: 2 });
  assert.equal(launcherState(inRound(2), false).kind, 'continue', 'once seen, it is simply waiting');
});

test('once finished it leads to the summary for the consultation', () => {
  for (const unseen of [false, true]) {
    assert.deepEqual(launcherState(session({ phase: 'finished', latest: fixtures.round2 }), unseen), {
      kind: 'finished', label: 'Ver el resumen para la consulta', detail: null, round: null,
    });
  }
});

test('a failure while hidden is mentioned, calmly, and keeps the way back in', () => {
  const error = 'Las preguntas no están disponibles en este momento. Tu resultado no cambió.';
  const idle = launcherState(session({ error }), false);
  assert.equal(idle.label, 'Afinar la lista');
  assert.equal(idle.detail, LAUNCHER_ERROR_DETAIL);
  const midway = launcherState(inRound(2, { error }), true);
  assert.equal(midway.kind, 'continue', 'a failed round is not announced as ready');
  assert.equal(midway.detail, LAUNCHER_ERROR_DETAIL);
  assert.match(LAUNCHER_ERROR_DETAIL, /resultado no cambió/);
});

test('the round shown never runs past the ceiling', () => {
  assert.equal(launcherState(inRound(5), false).detail, 'Ronda 3 de 3');
  assert.equal(launcherState(inRound(0), false).round, 1);
});
