import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// The module is plain TS with no runtime deps, so strip the type annotations
// rather than pulling in a transpiler just for this.
const src = readFileSync(new URL('../src/lib/especialidades.ts', import.meta.url), 'utf8')
  .replace(/: Record<string, string>/g, '')
  .replace(/\(nombre: string\): string/g, '(nombre)')
  .replace(/export /g, '');

const mod = new Function(`${src}; return { ESPECIALIDADES_ES, traducirEspecialidad };`)();
const { ESPECIALIDADES_ES, traducirEspecialidad } = mod;

test('translates the specialties seen in production', () => {
  assert.equal(traducirEspecialidad('Developmental disorders'), 'Trastornos del desarrollo');
  assert.equal(traducirEspecialidad('Renal'), 'Nefrología');
});

test('is case and whitespace insensitive', () => {
  assert.equal(traducirEspecialidad('  NEUROLOGY  '), 'Neurología');
  assert.equal(traducirEspecialidad('CaRdIoLoGy'), 'Cardiología');
});

test('passes unknown specialties through unchanged', () => {
  assert.equal(traducirEspecialidad('Xenobiology'), 'Xenobiology');
});

test('never returns empty for a non-empty input', () => {
  for (const key of Object.keys(ESPECIALIDADES_ES)) {
    assert.ok(traducirEspecialidad(key).length > 0);
  }
});

test('every mapping is translated, not echoed back', () => {
  for (const [en, es] of Object.entries(ESPECIALIDADES_ES)) {
    assert.notEqual(en, es, `"${en}" is not actually translated`);
  }
});

test('all keys are already lowercase so lookups can hit', () => {
  for (const key of Object.keys(ESPECIALIDADES_ES)) {
    assert.equal(key, key.toLowerCase(), `key "${key}" would never match`);
  }
});
