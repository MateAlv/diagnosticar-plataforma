import assert from 'node:assert/strict';
import test from 'node:test';
import { importTs } from './helpers/ts-module.mjs';

/**
 * The birth date, typed as DD/MM/AAAA, and the age it gives in the unit a
 * clinical record uses: days for a newborn, months up to two years, years
 * after. An adult never sees months.
 */

const { maskDmy, readDmy, formatDmy, ageText } = await importTs('lib/patient-age.ts');

const NOW = new Date('2026-10-05T12:00:00');

test('the slashes go in as the digits are typed', () => {
  assert.equal(maskDmy('0'), '0');
  assert.equal(maskDmy('030'), '03/0');
  assert.equal(maskDmy('03041966'), '03/04/1966');
  assert.equal(maskDmy('03/04/1966'), '03/04/1966');
  assert.equal(maskDmy('03-04-19661234'), '03/04/1966');
});

test('a complete date is read only when it is a real past day within a lifetime', () => {
  assert.deepEqual(readDmy('03/04/2018', NOW), { iso: '2018-04-03' });
  assert.deepEqual(readDmy('29/02/2024', NOW), { iso: '2024-02-29' });
  assert.deepEqual(readDmy('05/10/2026', NOW), { iso: '2026-10-05' });
  assert.ok('error' in readDmy('29/02/2023', NOW));
  assert.ok('error' in readDmy('31/04/2020', NOW));
  assert.ok('error' in readDmy('06/10/2026', NOW));
  assert.ok('error' in readDmy('01/01/1880', NOW));
  assert.ok('incomplete' in readDmy('03/04/20', NOW));
  assert.ok('incomplete' in readDmy('', NOW));
});

test('a stored date shows back as DD/MM/AAAA', () => {
  assert.equal(formatDmy('2018-04-03'), '03/04/2018');
  assert.equal(formatDmy('2018-04-03T00:00:00.000Z'), '03/04/2018');
  assert.equal(formatDmy(''), '');
  assert.equal(formatDmy(null), '');
});

test('the age is in days under a month, months under two years, years after', () => {
  assert.equal(ageText('2026-10-05', NOW), '0 días');
  assert.equal(ageText('2026-10-04', NOW), '1 día');
  assert.equal(ageText('2026-09-20', NOW), '15 días');
  assert.equal(ageText('2026-09-05', NOW), '1 mes');
  assert.equal(ageText('2025-10-05', NOW), '12 meses');
  assert.equal(ageText('2024-10-06', NOW), '23 meses');
  assert.equal(ageText('2024-10-05', NOW), '2 años');
  assert.equal(ageText('1966-04-03', NOW), '60 años');
});

test('no age for a missing, unreadable or future date', () => {
  for (const bad of [null, undefined, '', '05/10/2020', '2030-01-01']) assert.equal(ageText(bad, NOW), null, String(bad));
});
