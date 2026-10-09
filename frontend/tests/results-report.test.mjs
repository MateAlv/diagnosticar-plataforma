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
    { symbol: 'CFTR', score: 0.85, summary: 'Este gen codifica un canal de cloruro de los epitelios. Su activación depende de la fosforilación. [provided by RefSeq, Jul 2008]' },
    { symbol: 'DNAH5', score: 0.08, summary: null },
    { symbol: 'SCNN1A', score: 0.012, summary: 'Codifica una subunidad del canal de sodio epitelial.' },
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
    /^1\. CFTR — Este gen codifica un canal de cloruro de los epitelios\. Su activación depende de la fosforilación\.\n   Puntaje del modelo: alto\n   Ficha en GeneCards: https:\/\/www\.genecards\.org\/cgi-bin\/carddisp\.pl\?gene=CFTR$/m,
  );
  assert.match(t, /^2\. DNAH5\n   Puntaje del modelo: medio\n   Ficha en GeneCards: /m);
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

test('each gene says its score band: alto from 0,8, medio from 0,05, bajo under it', () => {
  const genes = buildResultsReport(input({
    genes: [0.8, 0.7999, 0.05, 0.0499].map((score, i) => ({ symbol: `G${i}`, score, summary: null })),
  })).sections.at(-1).blocks.find((b) => b.kind === 'genes').genes;
  assert.deepEqual(genes.map((g) => g.score), [
    'Puntaje del modelo: alto',
    'Puntaje del modelo: medio',
    'Puntaje del modelo: medio',
    'Puntaje del modelo: bajo',
  ]);
  assert.deepEqual(genes.map((g) => g.high), [true, false, false, false]);
  assert.match(text(), /alto \(0,8 o más\), medio \(de 0,05 a 0,8\) o bajo \(menos de 0,05\)/);
  assert.match(text({ adjustedByAnswers: true }), /^1\. CFTR — .*\n   Puntaje con las respuestas: alto$/m);
});

const PROFILE = {
  simbolo: 'CFTR',
  nombre_completo: 'CF transmembrane conductance regulator',
  cromosoma: '7',
  ubicacion: '7q31.2',
  omim_gen: '602421',
  resumen_es: null,
  resumen_llano_es: null,
  enfermedades: [{ nombre: 'Fibrosis quística', descripcion_es: '', omim: '219700' }, { nombre: 'Pancreatitis', descripcion_es: '', omim: '' }],
  coincidencias: [{ hpo_id: 'HP:0012735', nombre: 'Tos crónica', frecuencia_pct: 90, frecuencia_texto: null }],
  coincidencias_por_reporte: [
    { reportado_hpo_id: 'HP:0012735', exacta: { hpo_id: 'HP:0012735', nombre: 'Tos crónica', frecuencia_pct: 90, frecuencia_texto: null }, especificas: [] },
    { reportado_hpo_id: 'HP:0004322', exacta: null, especificas: [{ hpo_id: 'HP:0003510', nombre: 'Talla baja grave', frecuencia_pct: null, frecuencia_texto: null }] },
  ],
  frecuentes_no_reportados: [{ hpo_id: 'HP:0002613', nombre: 'Cirrosis biliar', frecuencia_pct: 40, frecuencia_texto: null }],
  total_esperados: 12,
  reportados_cubiertos: ['HP:0012735', 'HP:0004322'],
  referencias: { ClinVar: 'https://www.ncbi.nlm.nih.gov/clinvar/?term=CFTR%5Bgene%5D' },
  tecnico: {
    resumen_es: null, funcion_proteina_es: 'Canal de cloruro regulado por AMPc. [provided by UniProt]', resumen_en: null,
    funcion_proteina_en: null, aliases: 'ABC35, CFRD', ncbi_id: '1080', uniprot_accession: 'P13569', codigo_omim: ['602421'],
  },
};

test('with «Ver detalle médico» on, each gene carries what that view shows', () => {
  const medical = (over) => text({
    medicalDetail: true,
    genes: [{ symbol: 'CFTR', score: 0.851266, summary: null, profile: PROFILE }, { symbol: 'DNAH5', score: 0.02, summary: null, profile: null }],
    ...over,
  });
  const t = medical();
  assert.match(t, /Incluye el detalle médico de cada gen/);
  assert.match(t, /^   Puntaje del modelo: alto \(0\.851\)$/m);
  assert.match(t, /- CF transmembrane conductance regulator\n     - Locus 7q31\.2\n     - Alias: ABC35, CFRD\n     - NCBI:1080\n     - OMIM del gen: https:\/\/www\.omim\.org\/entry\/602421/);
  assert.match(t, /Informado «Tos crónica»: coincidencia directa con Tos crónica \(HP:0012735\) · muy frecuente \(90%\)/);
  assert.match(t, /Informado «Talla baja»: coincidencia parcial; las condiciones describen formas más específicas: Talla baja grave \(HP:0003510\)/);
  assert.match(t, /Condiciones asociadas \(2\):\n     - Fibrosis quística \(OMIM 219700\)\n     - Pancreatitis$/m);
  assert.match(t, /que no se informaron:\n     - Cirrosis biliar \(40%\)/);
  assert.match(t, /Función de la proteína:\n     - Canal de cloruro regulado por AMPc\.$/m);
  assert.match(t, /ClinVar: https:\/\/www\.ncbi/);
  assert.match(t, /^2\. DNAH5\n   Puntaje del modelo: bajo \(0\.020\)\n   Ficha en GeneCards: .*\n   Detalle:\n     - Sin descripción disponible para este gen\.$/m);

  const plain = text({ genes: [{ symbol: 'CFTR', score: 0.851266, summary: null, profile: PROFILE }] });
  assert.doesNotMatch(plain, /detalle médico|Locus|OMIM 219700|Cirrosis biliar|0\.851/);
});
