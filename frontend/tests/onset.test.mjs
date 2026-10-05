import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { importTs } from './helpers/ts-module.mjs';

/**
 * Symptom onset: the HPO classes and their age boundaries, the earliest onset
 * across findings, when "Precisar" is offered, what is saved, and the optional
 * fields on the /rank-genes request (absent unless onset was given).
 */

const {
  ONSET_CLASSES, classForAge, toYears, fromYears, patientAgeYears, ageContext, classAllowed, ageAllowed,
  parseOnset, earliestOnset, onsetPayloadFields, onsetForSave, onsetInformativeIds, showsPrecisar,
} = await importTs('lib/onset.ts');

const NOW = new Date('2026-10-04T12:00:00Z');
const on = (hpo_id, age_years = null) => ({ hpo_id, age_years });
const finding = (code, onset) => ({ code, onset });

test('the chips follow the HPO definitions, in time order', () => {
  assert.deepEqual(
    ONSET_CLASSES.map((c) => [c.hpo_id, c.label]),
    [
      ['HP:0030674', 'Antes de nacer'],
      ['HP:0003577', 'Al nacer'],
      ['HP:0003623', 'En el primer mes'],
      ['HP:0003593', 'Entre 1 y 12 meses'],
      ['HP:0011463', 'Entre 1 y 5 años'],
      ['HP:0003621', 'Entre 5 y 15 años'],
      ['HP:0011462', 'Entre 16 y 40 años'],
      ['HP:0003596', 'Entre 40 y 60 años'],
      ['HP:0003584', 'Después de los 60'],
    ],
  );
});

test('an exact age lands in the HPO class that contains it', () => {
  const cases = [
    [0, 'HP:0003577'], [0.05, 'HP:0003623'], [0.5, 'HP:0003593'], [0.99, 'HP:0003593'],
    [1, 'HP:0011463'], [4.9, 'HP:0011463'], [5, 'HP:0003621'], [15.5, 'HP:0003621'],
    [16, 'HP:0011462'], [39.9, 'HP:0011462'], [40, 'HP:0003596'], [60, 'HP:0003596'], [61, 'HP:0003584'], [90, 'HP:0003584'],
  ];
  for (const [years, id] of cases) assert.equal(classForAge(years).hpo_id, id, `${years} años`);
});

test('exact ages convert between months and years', () => {
  assert.equal(toYears(18, 'months'), 1.5);
  assert.equal(toYears(3, 'years'), 3);
  assert.equal(toYears(-1, 'years'), null);
  assert.equal(toYears(Number.NaN, 'years'), null);
  assert.deepEqual(fromYears(0.5), { amount: 6, unit: 'months' });
  assert.deepEqual(fromYears(3), { amount: 3, unit: 'years' });
  assert.equal(classForAge(toYears(3, 'months')).hpo_id, 'HP:0003593');
});

test('the birth date limits what can be chosen', () => {
  const years = patientAgeYears('2018-04-03', NOW);
  assert.equal(Math.floor(years), 8);
  assert.equal(ageContext(years), 'Hoy tiene 8 años');
  const allowed = ONSET_CLASSES.filter((c) => classAllowed(c, years)).map((c) => c.label);
  assert.deepEqual(allowed.slice(-1), ['Entre 5 y 15 años']);
  assert.equal(allowed.length, 6);
  assert.equal(ageAllowed(7, years), true);
  assert.equal(ageAllowed(9, years), false);
});

test('a baby only has the earliest classes, and says its age in months', () => {
  const years = patientAgeYears('2026-06-04', NOW);
  assert.equal(ageContext(years), 'Hoy tiene 4 meses');
  assert.deepEqual(
    ONSET_CLASSES.filter((c) => classAllowed(c, years)).map((c) => c.hpo_id),
    ['HP:0030674', 'HP:0003577', 'HP:0003623', 'HP:0003593'],
  );
});

test('without a usable birth date nothing is limited', () => {
  for (const birth of [null, undefined, '', 'ayer', '2030-01-01']) {
    const years = patientAgeYears(birth, NOW);
    assert.equal(years, null, String(birth));
    assert.equal(ONSET_CLASSES.every((c) => classAllowed(c, years)), true);
    assert.equal(ageAllowed(99, years), true);
  }
});

test('stored onset is read defensively', () => {
  assert.deepEqual(parseOnset({ hpo_id: 'hp:0003593', age_years: 0.5 }), on('HP:0003593', 0.5));
  assert.deepEqual(parseOnset({ hpo_id: 'HP:0003593' }), on('HP:0003593', null));
  assert.equal(parseOnset({ hpo_id: 'HP:0001250' }), null, 'a symptom is not an onset class');
  for (const bad of [null, undefined, 'x', 3, {}, { age_years: 3 }]) assert.equal(parseOnset(bad), null);
  assert.equal(parseOnset({ hpo_id: 'HP:0003593', age_years: -2 }).age_years, null);
});

test('the patient onset is the earliest class and the earliest age among the findings', () => {
  const found = earliestOnset([
    finding('HP:0001250', on('HP:0011463', 3)),
    finding('HP:0001251', on('HP:0003593', 0.5)),
    finding('HP:0001249', on('HP:0003621', 9)),
    finding('HP:0001324'),
  ]);
  assert.deepEqual(found, on('HP:0003593', 0.5));
});

test('class and age are compared separately: a class without an age leaves the age to the others', () => {
  assert.deepEqual(
    earliestOnset([finding('HP:1', on('HP:0003577')), finding('HP:2', on('HP:0011463', 3))]),
    on('HP:0003577', 3),
  );
  assert.equal(earliestOnset([finding('HP:1'), finding('HP:2', null)]), null);
  assert.equal(earliestOnset([]), null);
});

test('without onset the request fields are absent, so the payload is unchanged', () => {
  assert.deepEqual(onsetPayloadFields([finding('HP:0001250'), finding('HP:0001251', null)]), {});
  const before = JSON.stringify({ hpo_ids: ['HP:0001250'], top_k: 50 });
  const after = JSON.stringify({ hpo_ids: ['HP:0001250'], top_k: 50, ...onsetPayloadFields([finding('HP:0001250')]) });
  assert.equal(after, before);
});

test('with onset the request carries the patient onset and each finding\'s', () => {
  const fields = onsetPayloadFields([
    finding('HP:0001250', on('HP:0003593', 0.5)),
    finding('HP:0001251'),
    finding('hp:0001249', on('HP:0011463')),
  ]);
  assert.deepEqual(fields, {
    onset_hpo_id: 'HP:0003593',
    onset_age_years: 0.5,
    symptom_onsets: [
      { hpo_id: 'HP:0001250', onset_hpo_id: 'HP:0003593', onset_age_years: 0.5 },
      { hpo_id: 'HP:0001249', onset_hpo_id: 'HP:0011463' },
    ],
  });
});

test('with only a class, no age field is sent at all', () => {
  const fields = onsetPayloadFields([finding('HP:0001250', on('HP:0003577'))]);
  assert.equal('onset_age_years' in fields, false);
  assert.equal('onset_age_years' in fields.symptom_onsets[0], false);
});

test('what is saved round-trips, and a symptom without onset saves no key', () => {
  assert.deepEqual(onsetForSave(null), {});
  assert.deepEqual(onsetForSave(undefined), {});
  const saved = JSON.parse(JSON.stringify({ code: 'HP:0001250', ...onsetForSave(on('HP:0003593', 0.5)) }));
  assert.deepEqual(parseOnset(saved.onset), on('HP:0003593', 0.5));
});

test('Precisar shows for a refinable term or an onset-informative one, unless dismissed', () => {
  const show = (refinable, informative, dismissed = false, hasOnset = false) =>
    showsPrecisar({ refinable, informative, dismissed, hasOnset });
  assert.equal(show(true, false), true);
  assert.equal(show(false, true), true);
  assert.equal(show(true, true), true);
  assert.equal(show(false, false), false);
  assert.equal(show(true, false, true), false);
  assert.equal(show(false, true, true), false);
  assert.equal(show(false, false, false, true), true, 'a symptom with onset can always be edited');
  assert.equal(show(true, true, true, true), true);
});

test('the onset-informative list reads from the JSON file, whatever its contents', () => {
  const file = JSON.parse(readFileSync(new URL('../src/lib/onset-informative-terms.json', import.meta.url), 'utf8'));
  assert.equal(typeof file.version, 'string');
  assert.ok(file.threshold_bits === null || typeof file.threshold_bits === 'number');
  for (const term of file.terms) {
    for (const [key, type] of [['hpo_id', 'string'], ['label_en', 'string'], ['score_bits', 'number'], ['n_genes', 'number'], ['r1_train_count', 'number']]) {
      const nullable = key === 'score_bits' || key === 'n_genes';
      assert.ok(typeof term[key] === type || (nullable && term[key] === null), `${term.hpo_id} ${key}`);
    }
  }
  const ids = onsetInformativeIds(file);
  assert.equal(ids.size, new Set(file.terms.map((t) => t.hpo_id)).size);
  assert.ok(ids.size > 0);
  assert.equal(ids.has(file.terms[0].hpo_id), true);
  assert.equal(ids.has('HP:0000000'), false);
  assert.equal(onsetInformativeIds({ terms: [{ hpo_id: 'hp:0000118 ' }, { hpo_id: 'oops' }, null, {}] }).size, 1);
  for (const bad of [null, undefined, {}, { terms: 'x' }, []]) assert.equal(onsetInformativeIds(bad).size, 0);
});
