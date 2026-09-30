import assert from 'node:assert/strict';
import test from 'node:test';
import { importTs } from './helpers/ts-module.mjs';

/**
 * The specialty names a family reads. The rule under test: every name the
 * model's post-processing can return is shown in Spanish, and nothing reaches
 * the screen in English -- a name that is not a specialty, or is unknown, is
 * dropped instead.
 */

const { ESPECIALIDADES_ES, traducirEspecialidad, especialidadesParaConsultar } =
  await importTs('lib/especialidades.ts');

// SPECIALTY_CANONICAL's values in diagnostic.ar-api's specialist_recommendation.py.
const FROM_THE_MODEL = [
  'Audiology', 'Cancer', 'Cardiology', 'Dermatology', 'Developmental disorders', 'Endocrinology',
  'Gastrohepatology', 'Growth disorders', 'Haematology', 'Immunology', 'Metabolic', 'Musculoskeletal',
  'Neurology', 'Ophthalmology', 'Renal', 'Respiratory', 'Ultra-rare disorders',
];
const NOT_A_SPECIALTY = ['Multispecialty', 'Viral research', 'Unknown', ''];

test('every specialty the model returns has a Spanish name', () => {
  for (const name of FROM_THE_MODEL) {
    const es = traducirEspecialidad(name);
    assert.ok(es, `${name} has no translation`);
    assert.notEqual(es.toLowerCase(), name.toLowerCase());
  }
  assert.equal(traducirEspecialidad('Haematology'), 'Hematología');
  assert.equal(traducirEspecialidad('Respiratory'), 'Neumonología');
  assert.equal(traducirEspecialidad('Gastrohepatology'), 'Gastroenterología y hepatología');
});

test('categories that are not a specialty to consult are dropped', () => {
  for (const name of NOT_A_SPECIALTY) assert.equal(traducirEspecialidad(name), null, name);
});

test('an unknown name is dropped, never shown in English', () => {
  assert.equal(traducirEspecialidad('Xenobiology'), null);
});

test('case and surrounding spaces do not matter', () => {
  assert.equal(traducirEspecialidad('  NEUROLOGY  '), 'Neurología');
  assert.equal(traducirEspecialidad('CaRdIoLoGy'), 'Cardiología');
});

test('the list to consult is translated, filtered and without repeats', () => {
  assert.deepEqual(
    especialidadesParaConsultar(['Neurology', 'Unknown', 'Ultra-rare disorders', 'Ciliopathies', 'Viral research', 'Renal']),
    ['Neurología', 'Genética médica', 'Nefrología'],
  );
});

test('every mapping is actually translated', () => {
  for (const [en, es] of Object.entries(ESPECIALIDADES_ES)) {
    assert.notEqual(en, es.toLowerCase(), `"${en}" is echoed back`);
    assert.ok(es.length > 0);
  }
});
