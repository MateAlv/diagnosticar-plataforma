import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importTs } from './helpers/ts-module.mjs';

/**
 * What the onset selector puts on the page: labelled group and fields, which
 * chip is chosen, which are unavailable for a young patient, the age context
 * and the way to clear. Clicking and typing are covered end to end in
 * e2e/onset.spec.ts, and the mapping between chips and exact ages in
 * onset.test.mjs.
 */

const { OnsetSelector } = await importTs('lib/onset.ts', 'app/nuevo/onset-selector.tsx');

const NOW = new Date('2026-10-04T12:00:00Z');
const render = (props) =>
  renderToStaticMarkup(createElement(OnsetSelector, { value: null, onChange() {}, now: NOW, ...props }));
const radios = (html) => [...html.matchAll(/<input type="radio"[^>]*>/g)].map((m) => m[0]);

test('every chip is a radio inside a labelled group, with the question as its legend', () => {
  const html = render({});
  assert.match(html, /<legend[^>]*>¿A qué edad empezó este síntoma\?/);
  assert.match(html, /role="radiogroup" aria-label="Edad de inicio"/);
  assert.equal(radios(html).length, 10);
  for (const label of ['Antes de nacer', 'Al nacer', 'En el primer mes', 'Entre 1 y 12 meses', 'Entre 1 y 5 años',
    'Entre 5 y 15 años', 'Entre 16 y 40 años', 'Entre 40 y 60 años', 'Después de los 60', 'No sé']) {
    assert.match(html, new RegExp(`<label[^>]*>.*?<span>${label}</span></label>`), label);
  }
});

test('the exact age has a label, and so does its unit', () => {
  const html = render({});
  assert.match(html, /<label for="[^"]+"[^>]*>Edad exacta/);
  assert.match(html, /<input id="[^"]+" type="text" inputMode="decimal"/);
  assert.match(html, /<select aria-label="Unidad: años o meses"/);
  assert.match(html, /<option value="years" selected="">años<\/option>|<option value="years">años<\/option>/);
});

test('with nothing chosen "No sé" is the one selected, and there is nothing to clear', () => {
  const html = render({});
  const checked = radios(html).filter((r) => /checked=""/.test(r));
  assert.equal(checked.length, 1);
  assert.match(checked[0], /value="unknown"/);
  assert.doesNotMatch(html, /Borrar edad/);
});

test('an existing value shows chosen, with its exact age and a way to clear', () => {
  const html = render({ value: { hpo_id: 'HP:0011463', age_years: 3 } });
  const checked = radios(html).filter((r) => /checked=""/.test(r));
  assert.equal(checked.length, 1);
  assert.match(checked[0], /value="HP:0011463"/);
  assert.match(html, /<input id="[^"]+" type="text"[^>]*value="3"/);
  assert.match(html, /Borrar edad/);
});

test('an age in months is shown in months', () => {
  const html = render({ value: { hpo_id: 'HP:0003593', age_years: 0.5 } });
  assert.match(html, /value="6"/);
  assert.match(html, /<option value="months" selected="">meses<\/option>/);
});

test('a known birth date says how old the patient is and disables the later chips', () => {
  const html = render({ birthDate: '2018-04-03' });
  assert.match(html, /Hoy tiene 8 años/);
  const disabled = radios(html).filter((r) => /disabled=""/.test(r));
  assert.deepEqual(disabled.map((r) => r.match(/value="([^"]+)"/)[1]), ['HP:0011462', 'HP:0003596', 'HP:0003584']);
  assert.match(html, /no se pueden elegir/);
});

test('without a birth date nothing is disabled and no age is claimed', () => {
  const html = render({ birthDate: '' });
  assert.equal(radios(html).filter((r) => /disabled=""/.test(r)).length, 0);
  assert.doesNotMatch(html, /Hoy tiene/);
});

test('the error region is always there for a screen reader, empty until needed', () => {
  assert.match(render({}), /<p id="[^"]+" role="alert" class="sr-only"><\/p>/);
});
