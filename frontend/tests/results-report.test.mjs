import assert from 'node:assert/strict';
import test from 'node:test';
import { importTs } from './helpers/ts-module.mjs';

/**
 * The downloadable summary. What it must always carry: what was reported
 * (symptoms with their onset, what the text rules out, the answers, age), the
 * model's genes each with its GeneCards link, what a genetic disease is and
 * where to read more, the disclaimer word for word and the referral to
 * genetics. The PDF and the copied text come from the same report.
 */

const { buildResultsReport, reportToText, ageText, geneCardsUrl, reportFileName, SITE_URL } = await importTs(
  'lib/disclaimer.ts',
  'lib/onset.ts',
  'lib/results-report.ts',
);
const { RESULTS_DISCLAIMER } = await importTs('lib/disclaimer.ts');
const { pdfSafe } = await importTs('lib/results-pdf.ts');

const NOW = new Date('2026-10-05T12:00:00');

const input = (over = {}) => ({
  date: NOW,
  patient: { name: 'Juli', birthDate: '2019-04-03', sex: 'femenino' },
  clinicalText: 'Nena con tos crónica. No tuvo convulsiones.',
  symptoms: [
    { label: 'Tos crónica', code: 'HP:0012735', onset: { hpo_id: 'HP:0011463', age_years: 2 } },
    { label: 'Talla baja', code: 'HP:0004322', onset: null },
  ],
  negated: [{ label: 'Convulsiones', code: 'HP:0001250' }],
  answers: { yes: ['Sudor salado'], no: ['Pólipos nasales'], unsure: [] },
  genes: ['CFTR', 'DNAH5', 'SCNN1A'],
  specialties: ['Neumonología'],
  ...over,
});

const text = (over) => reportToText(buildResultsReport(input(over)));

test('what was reported: person, text, symptoms with onset, negations and answers', () => {
  const t = text();
  assert.match(t, /Nombre o apodo: Juli/);
  assert.match(t, /Edad: 7 años/);
  assert.match(t, /Sexo: Femenino/);
  assert.match(t, /Nena con tos crónica/);
  assert.match(t, /Tos crónica \(HP:0012735\) · empezó a los 2 años/);
  assert.match(t, /- Talla baja \(HP:0004322\)$/m);
  assert.match(t, /No presenta, según el relato:\n- Convulsiones \(HP:0001250\)/);
  assert.match(t, /Sí: Sudor salado/);
  assert.match(t, /No: Pólipos nasales/);
  assert.doesNotMatch(t, /No sabe:/);
});

test('every gene in the model order, each with its GeneCards link', () => {
  const t = text();
  assert.match(t, /1\. CFTR — https:\/\/www\.genecards\.org\/cgi-bin\/carddisp\.pl\?gene=CFTR/);
  assert.match(t, /3\. SCNN1A — /);
  assert.equal(geneCardsUrl('HLA-B'), 'https://www.genecards.org/cgi-bin/carddisp.pl?gene=HLA-B');
});

test('the model is explained and the site is linked', () => {
  const t = text();
  assert.match(t, /Human Phenotype Ontology/);
  assert.match(t, /GenPhenIA/);
  assert.ok(t.includes(SITE_URL));
  assert.match(t, /no dice qué tiene la persona/);
});

test('it says what a genetic disease is and where to read more', () => {
  const t = text();
  assert.match(t, /enfermedades causadas por cambios \(variantes\)/);
  for (const site of ['medlineplus.gov/spanish/genetica', 'orpha.net', 'fadepof.org.ar', 'omim.org']) assert.ok(t.includes(site), site);
});

test('the disclaimer word for word, and the referral to genetics', () => {
  const t = text();
  assert.ok(t.includes(RESULTS_DISCLAIMER));
  assert.match(t, /especialista en genética médica/);
});

test('missing data is left out, never printed empty', () => {
  const t = text({
    patient: { name: '', birthDate: null, sex: null },
    clinicalText: '',
    negated: [],
    answers: { yes: [], no: [], unsure: [] },
    symptoms: [{ label: 'Talla baja', code: 'HP:0004322' }],
  });
  assert.doesNotMatch(t, /Nombre o apodo|Edad:|Sexo:|Relato cargado|No presenta|Respuestas a las preguntas|edad de inicio es un dato/);
});

test('age reads in months under a year, and the file is dated', () => {
  assert.equal(ageText('2026-02-01', NOW), '8 meses');
  assert.equal(ageText('2025-10-05', NOW), '1 año');
  assert.equal(ageText('2030-01-01', NOW), null);
  assert.equal(reportFileName(NOW), 'diagnosticar-resumen-2026-10-05.pdf');
});

test('the PDF text keeps Spanish and replaces what its fonts cannot draw', () => {
  assert.equal(pdfSafe('Niño ¿tos? «sí» — ñandú · 1°'), 'Niño ¿tos? «sí» — ñandú · 1°');
  assert.equal(pdfSafe('Edad ≥ 5 · déficit de β-oxidación'), 'Edad >= 5 · déficit de beta-oxidación');
  assert.equal(pdfSafe('中'), '?');
});
