import assert from 'node:assert/strict';
import test from 'node:test';
import { importTs } from './helpers/ts-module.mjs';

/**
 * The age the wizard asks for, kept as the birth date it implies. What must
 * hold: an age turns into a date and back into the same age, on any day of
 * the month, and it keeps counting afterwards.
 */

const { ageFromBirthDate, birthDateFromAge, ageLabel } = await importTs('lib/patient-age.ts');

const day = (iso) => new Date(`${iso}T12:00:00`);

test('an age becomes a date and reads back as the same age', () => {
  for (const now of ['2026-10-05', '2026-03-31', '2024-02-29', '2026-01-01', '2026-12-31']) {
    for (const age of [{ years: 0, months: 0 }, { years: 0, months: 5 }, { years: 7, months: 3 }, { years: 1, months: 11 }, { years: 45, months: 0 }]) {
      assert.deepEqual(ageFromBirthDate(birthDateFromAge(age, day(now)), day(now)), age, `${JSON.stringify(age)} on ${now}`);
    }
  }
});

test('the end of a short month does not spill into the next', () => {
  assert.equal(birthDateFromAge({ years: 0, months: 1 }, day('2026-03-31')), '2026-02-28');
  assert.equal(birthDateFromAge({ years: 1, months: 0 }, day('2024-02-29')), '2023-02-28');
});

test('the age keeps counting after it was given', () => {
  const born = birthDateFromAge({ years: 7, months: 3 }, day('2026-10-05'));
  assert.deepEqual(ageFromBirthDate(born, day('2027-10-05')), { years: 8, months: 3 });
});

test('no age for a missing, malformed or future date', () => {
  for (const bad of [null, undefined, '', '05/10/2020', '2030-01-01']) assert.equal(ageFromBirthDate(bad, day('2026-10-05')), null, String(bad));
});

test('the label reads naturally', () => {
  assert.equal(ageLabel({ years: 7, months: 3 }), '7 años y 3 meses');
  assert.equal(ageLabel({ years: 1, months: 1 }), '1 año y 1 mes');
  assert.equal(ageLabel({ years: 0, months: 5 }), '5 meses');
  assert.equal(ageLabel({ years: 2, months: 0 }), '2 años');
  assert.equal(ageLabel({ years: 0, months: 0 }), 'Menos de 1 mes');
});
