import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importTs } from './helpers/ts-module.mjs';

/**
 * When the wizard offers to refine a symptom. The rule under test: a term is
 * offered when it sits high in the HPO tree (at least two forms directly
 * beneath and three anywhere beneath) and still reaches enough genes for the
 * choice to matter; it is pointed out only when it is much higher. The cases
 * are real terms with the counts measured in docs/PRECISAR_SINTOMAS.md. And a
 * failed lookup never turns into an error on screen.
 */

const { canRefine, isBroadTerm, genesLabel, typesLabel, subtypesLabel, fetchTerms, fetchChildren } =
  await importTs('lib/hpo-terms.ts');

const t = (nombre, genes, hijos, debajo) => ({ hpo_id: 'HP:0000000', nombre, genes, tiene_hijos: hijos > 0, hijos, debajo });

const SEIZURE = t('Convulsiones', 1560, 12, 104);
const LAXITY = t('Hiperlaxitud articular', 349, 4, 14);
const MICROCEPHALY = t('Microcefalia', 1052, 2, 4);
const PECTUS = t('Pectus excavatum', 234, 1, 1);
const ECTOPIA = t('Ectopia del cristalino', 36, 2, 2);
const NEUROFIBROMAS = t('Neurofibromas', 10, 2, 4);
const ARACHNODACTYLY = t('Aracnodactilia', 73, 0, 0);

test('a term high in the tree is offered and pointed out', () => {
  for (const term of [SEIZURE, LAXITY]) {
    assert.equal(canRefine(term), true, term.nombre);
    assert.equal(isBroadTerm(term), true, term.nombre);
  }
});

test('a term with a few forms beneath is offered but not pointed out', () => {
  assert.equal(canRefine(MICROCEPHALY), true);
  assert.equal(isBroadTerm(MICROCEPHALY), false);
});

test('a single form beneath is a particular case, not a choice', () => {
  // Pectus excavatum reaches 234 genes, but its only child is the lower-sternum form.
  assert.equal(canRefine(PECTUS), false);
});

test('two leaves beneath are not enough depth', () => {
  assert.equal(canRefine(ECTOPIA), false);
});

test('a term that already reaches few genes is not offered', () => {
  assert.equal(canRefine(NEUROFIBROMAS), false);
});

test('a leaf, an unknown term, or one from an older server is not offered', () => {
  assert.equal(canRefine(ARACHNODACTYLY), false);
  assert.equal(canRefine(undefined), false);
  assert.equal(canRefine({ hpo_id: 'HP:1', nombre: '', genes: 1560, tiene_hijos: true }), false);
});

test('the fixture tree carries the real counts', () => {
  const tree = JSON.parse(readFileSync(new URL('../mocks/fixtures.json', import.meta.url), 'utf8')).hpoTree;
  const seizure = tree.terms['HP:0001250'];
  assert.deepEqual([seizure.hijos, seizure.debajo], [12, 104]);
});

test('counts read in Spanish', () => {
  assert.equal(typesLabel(14), '14 tipos más específicos');
  assert.equal(typesLabel(1), '1 tipo más específico');
});

test('the subtype count matches the list the dialog shows', () => {
  // Hipertensión: 4 direct types, one of them with a variant of its own.
  assert.equal(subtypesLabel({ hijos: 4, debajo: 5 }), '4 tipos más específicos (5 contando sus variantes)');
  assert.equal(subtypesLabel({ hijos: 3, debajo: 3 }), '3 tipos más específicos');
  assert.equal(subtypesLabel({ hijos: 1, debajo: 1 }), '1 tipo más específico');
  assert.equal(subtypesLabel({ hijos: 12, debajo: 1040 }), '12 tipos más específicos (1.040 contando sus variantes)');
  assert.equal(subtypesLabel({ hijos: 0, debajo: 0 }), null);
  assert.equal(subtypesLabel(undefined), null);
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
