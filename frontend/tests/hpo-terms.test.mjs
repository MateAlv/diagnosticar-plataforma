import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importTs } from './helpers/ts-module.mjs';

/**
 * When the wizard offers to refine a symptom. The rule under test: only terms
 * that reach many genes AND have something beneath them are flagged, and a
 * failed lookup never turns into an error on screen.
 */

const { isGeneralTerm, genesLabel, fetchTerms, fetchChildren, GENERAL_TERM_MIN_GENES } =
  await importTs('lib/hpo-terms.ts');

const tree = JSON.parse(readFileSync(new URL('../mocks/fixtures.json', import.meta.url), 'utf8')).hpoTree;
const term = (id) => ({ hpo_id: id, ...tree.terms[id] });

test('a term reaching many genes with forms beneath it is general', () => {
  assert.equal(isGeneralTerm(term('HP:0001250')), true); // Convulsiones, 1.560 genes
});

test('a narrow term is not flagged', () => {
  assert.equal(isGeneralTerm(term('HP:0002027')), false); // Dolor abdominal, 83 genes
});

test('a broad term with nothing to refine it into is not flagged', () => {
  // Bronquiectasias reaches 130 genes but has no child with data: flagging it
  // would offer a dialog with nothing in it.
  const bronchiectasis = term('HP:0002110');
  assert.ok(bronchiectasis.genes >= GENERAL_TERM_MIN_GENES);
  assert.equal(isGeneralTerm(bronchiectasis), false);
});

test('an unknown term is not flagged', () => {
  assert.equal(isGeneralTerm(undefined), false);
  assert.equal(isGeneralTerm({ hpo_id: 'HP:1', nombre: '', genes: 0, tiene_hijos: false }), false);
});

test('gene counts read in Spanish', () => {
  assert.equal(genesLabel(1560), '1.560 genes');
  assert.equal(genesLabel(1), '1 gen');
});

test('a failed lookup resolves to nothing, not an error', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.equal((await fetchTerms(['HP:0001250'])).size, 0);
  assert.equal(await fetchChildren('HP:0001250'), null);
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
  assert.equal((await fetchTerms(['HP:0001250'])).size, 0);
  assert.equal(await fetchChildren('HP:0001250'), null);
});

test('only valid HPO ids are asked for, once each', async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => ({ terminos: [{ hpo_id: 'HP:0001250', nombre: 'Convulsiones', genes: 1560, tiene_hijos: true }] }) };
  };
  const found = await fetchTerms(['hp:0001250', 'HP:0001250', 'banana', '']);
  assert.equal(urls.length, 1);
  assert.match(decodeURIComponent(urls[0]), /ids=HP:0001250$/);
  assert.equal(found.get('HP:0001250').genes, 1560);
  assert.equal((await fetchTerms(['banana'])).size, 0);
});
