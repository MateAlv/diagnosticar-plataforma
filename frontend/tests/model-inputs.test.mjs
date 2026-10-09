import assert from 'node:assert/strict';
import test from 'node:test';
import { importTs } from './helpers/ts-module.mjs';

/**
 * The patient fields /rank-genes may use besides the symptoms. Each is left
 * out when unknown, so a search without them is the request it always was.
 */

const { modelCaseFields, ageInYears } = await importTs('lib/onset-informative-terms.json', 'lib/onset.ts', 'lib/model-inputs.ts');

const NOW = new Date('2026-10-09T12:00:00');

test('sex is sent only as male or female', () => {
  assert.equal(modelCaseFields({ sexo: 'masculino' }, [], NOW).sex, 'male');
  assert.equal(modelCaseFields({ sexo: 'femenino' }, [], NOW).sex, 'female');
  for (const sexo of ['no_binario', 'prefiero_no_decir', '', null, undefined]) {
    assert.equal('sex' in modelCaseFields({ sexo }, [], NOW), false);
  }
});

test('the age comes from the birth date, in years', () => {
  assert.equal(ageInYears('2012-03-15', NOW), 14.57);
  assert.equal(ageInYears('2026-10-09', NOW), 0);
  assert.equal(ageInYears('2026-10-10', NOW), null);
  assert.equal(ageInYears('', NOW), null);
  assert.equal(modelCaseFields({ fechaNacimiento: '2012-03-15' }, [], NOW).age_years, 14.57);
  assert.equal('age_years' in modelCaseFields({ fechaNacimiento: null }, [], NOW), false);
});

test('the onset is the earliest exact age; a range alone is not sent', () => {
  const symptoms = [
    { code: 'HP:0001250', onset: { hpo_id: 'HP:0011463', age_years: 3 } },
    { code: 'HP:0004322', onset: { hpo_id: 'HP:0003593', age_years: 0.5 } },
    { code: 'HP:0001263', onset: null },
  ];
  assert.equal(modelCaseFields({}, symptoms, NOW).onset_years, 0.5);
  const rangeOnly = [{ code: 'HP:0001250', onset: { hpo_id: 'HP:0011463', age_years: null } }];
  assert.equal('onset_years' in modelCaseFields({}, rangeOnly, NOW), false);
});

test('nothing known, nothing sent', () => {
  assert.deepEqual(modelCaseFields({}, [{ code: 'HP:0001250' }], NOW), {});
});
