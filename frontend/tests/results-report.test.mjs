import assert from 'node:assert/strict';
import test from 'node:test';
import { importTs } from './helpers/ts-module.mjs';

/**
 * The downloadable summary. What it must always carry: the disclaimer word
 * for word and the referral to genetics, first; the reported profile (how it
 * was loaded, symptoms with their HPO links and onset, what the text rules
 * out, the answers, age); what a genetic disease is and where to read more;
 * and last the model's genes, each with a brief description and its GeneCards
 * link. The PDF and the copied text come from the same report.
 */

const { buildResultsReport, reportToText, briefGeneSummary, reportFileName, SITE_URL } = await importTs(
  'lib/disclaimer.ts',
  'lib/genes-api.ts',
  'lib/onset.ts',
  'lib/patient-age.ts',
  'lib/gene-pages.json',
  'lib/reference-links.ts',
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
    { label: 'Tos crónica', code: 'HP:0012735', onset: { hpo_id: 'HP:0011463', age_years: 2 }, source: 'texto' },
    { label: 'Talla baja', code: 'HP:0004322', onset: null, source: 'manual' },
  ],
  negated: [{ label: 'Convulsiones', code: 'HP:0001250' }],
  answers: { yes: ['Sudor salado'], no: ['Pólipos nasales'], unsure: [] },
  genes: [
    { symbol: 'CFTR', summary: 'Este gen codifica un canal de cloruro de los epitelios. Su activación depende de la fosforilación. [provided by RefSeq, Jul 2008]' },
    { symbol: 'DNAH5', summary: null },
    { symbol: 'SCNN1A', summary: 'Codifica una subunidad del canal de sodio epitelial.' },
  ],
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
  assert.match(t, /- Tos crónica \(HP:0012735\) · empezó a los 2 años — https:\/\/hpo\.jax\.org\/browse\/term\/HP:0012735$/m);
  assert.match(t, /- Talla baja \(HP:0004322\) — https:\/\/hpo\.jax\.org\/browse\/term\/HP:0004322$/m);
  assert.match(t, /No presenta, según el relato:\n- Convulsiones \(HP:0001250\) — https:\/\/hpo\.jax\.org/);
  assert.match(t, /Sí: Sudor salado/);
  assert.match(t, /No: Pólipos nasales/);
  assert.doesNotMatch(t, /No sabe:/);
});

test('every gene in the model order, with a brief description and its GeneCards link apart', () => {
  const t = text();
  assert.match(
    t,
    /^1\. CFTR — Este gen codifica un canal de cloruro de los epitelios\. Su activación depende de la fosforilación\.\n   Ficha en GeneCards: https:\/\/www\.genecards\.org\/cgi-bin\/carddisp\.pl\?gene=CFTR$/m,
  );
  assert.match(t, /^2\. DNAH5\n   Ficha en GeneCards: /m);
  assert.match(t, /^3\. SCNN1A — Codifica/m);
});

test('the profile says how it was loaded and what HPO is', () => {
  const t = text();
  assert.match(t, /^1\. PERFIL INFORMADO DEL PACIENTE$/m);
  assert.match(t, /1 se detectó automáticamente en el relato escrito y 1 se eligió en el buscador de síntomas/);
  assert.match(t, /Human Phenotype Ontology \(HPO\)/);
  assert.match(text({ symptoms: [{ label: 'Talla baja', code: 'HP:0004322' }] }), /escribiendo un relato, del que se detectan automáticamente, o eligiéndolos en un buscador/);
});

test('the model result comes last, on a page of its own', () => {
  const report = buildResultsReport(input());
  const titles = report.sections.map((s) => s.title);
  assert.deepEqual(titles, [
    'Importante',
    '1. Perfil informado del paciente',
    '2. Qué son las enfermedades genéticas y dónde leer más',
    '3. Resultado del modelo',
  ]);
  assert.equal(report.sections.at(-1).newPage, true);
  assert.doesNotMatch(text(), /lista ajustada/);
  assert.match(text({ adjustedByAnswers: true }), /lista ajustada con las respuestas/);
});

test('a gene summary is cut to its first sentences', () => {
  assert.equal(briefGeneSummary(null), null);
  assert.equal(briefGeneSummary('  [provided by RefSeq]'), null);
  const short = 'Uno corto.';
  const long = 'Este gen codifica una proteína de la matriz extracelular que da sostén a los tejidos elásticos del cuerpo.';
  assert.equal(briefGeneSummary(`${short} ${long} Tercera oración que ya sobra.`), `${short} ${long}`);
  const huge = `${'palabra '.repeat(80)}fin.`;
  const cut = briefGeneSummary(huge);
  assert.ok(cut.length <= 301 && cut.endsWith('…'), cut);
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

test('the age is in the unit a clinical record would use, and the file is dated', () => {
  assert.match(text({ patient: { name: '', birthDate: '2025-10-05', sex: null } }), /Edad: 12 meses/);
  assert.match(text({ patient: { name: '', birthDate: '2026-09-20', sex: null } }), /Edad: 15 días/);
  assert.doesNotMatch(text({ patient: { name: '', birthDate: '2030-01-01', sex: null } }), /Edad:/);
  assert.equal(reportFileName(NOW), 'diagnosticar-resumen-2026-10-05.pdf');
});

test('the PDF text keeps Spanish and replaces what its fonts cannot draw', () => {
  assert.equal(pdfSafe('Niño ¿tos? «sí» — ñandú · 1°'), 'Niño ¿tos? «sí» — ñandú · 1°');
  assert.equal(pdfSafe('Edad ≥ 5 · déficit de β-oxidación'), 'Edad >= 5 · déficit de beta-oxidación');
  assert.equal(pdfSafe('中'), '?');
});
