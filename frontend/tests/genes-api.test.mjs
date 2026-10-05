import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * Unit tests for the /api/genes client.
 *
 * The module is plain TS with no runtime deps, so the type annotations are
 * stripped rather than pulling in a transpiler — the same approach as
 * especialidades.test.mjs.
 *
 * The rule under test throughout: a gene description enriches a result and
 * never gates it. Every failure path must resolve to "no description", never
 * to a thrown error that would cost the user their ranking.
 */
import ts from 'typescript';

// Transpile with the real compiler rather than stripping types by hand: a
// regex approach silently breaks on generics, and a test that cannot run is
// worse than no test.
const source = readFileSync(new URL('../src/lib/genes-api.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

// The module reads process.env at import time and calls fetch at call time;
// both are injected so each test controls them.
function load(fetchImpl) {
  const body = js
    .replace(/^export /gm, '')
    .replace(/"use client";?/, '');
  return new Function(
    'fetch',
    'process',
    `${body}; return { fetchGeneProfile, fetchGeneProfiles, describeFrequency, geneReferenceLinks, omimUrl, formatScore, stripProvenance };`,
  )(fetchImpl, { env: { NEXT_PUBLIC_API_URL: 'http://api.test' } });
}

const PROFILE = { simbolo: 'CFTR', enfermedades: [], coincidencias: [], frecuentes_no_reportados: [] };
const ok = () => Promise.resolve({ ok: true, json: () => Promise.resolve(PROFILE) });

test('requests the reported phenotypes so the server can compare them', async () => {
  const calls = [];
  const { fetchGeneProfile } = load((url) => { calls.push(url); return ok(); });

  await fetchGeneProfile('CFTR', ['HP:0002110', 'HP:0001508']);

  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/genes\/CFTR\?/);
  assert.match(decodeURIComponent(calls[0]), /reported=HP:0002110,HP:0001508/);
});

test('drops malformed phenotype ids rather than forwarding them', async () => {
  const calls = [];
  const { fetchGeneProfile } = load((url) => { calls.push(url); return ok(); });

  await fetchGeneProfile('CFTR', ['HP:0002110', 'not-an-hpo-id', '', 'HP:123']);

  assert.match(decodeURIComponent(calls[0]), /reported=HP:0002110$/);
});

test('omits the query entirely when nothing was reported', async () => {
  const calls = [];
  const { fetchGeneProfile } = load((url) => { calls.push(url); return ok(); });

  await fetchGeneProfile('CFTR', []);

  assert.equal(calls[0], 'http://api.test/genes/CFTR');
});

test('asks for the technical block only in the professional view', async () => {
  const calls = [];
  const { fetchGeneProfile } = load((url) => { calls.push(url); return ok(); });

  await fetchGeneProfile('CFTR', [], { professional: true });
  await fetchGeneProfile('CFTR', [], {});

  assert.match(calls[0], /view=professional/);
  assert.doesNotMatch(calls[1], /view=/);
});

test('encodes the symbol into the path', async () => {
  const calls = [];
  const { fetchGeneProfile } = load((url) => { calls.push(url); return ok(); });

  await fetchGeneProfile('A/B', []);

  assert.match(calls[0], /\/genes\/A%2FB$/);
});

test('sends credentials, since the route is authenticated', async () => {
  let init;
  const { fetchGeneProfile } = load((_url, options) => { init = options; return ok(); });

  await fetchGeneProfile('CFTR', []);

  assert.equal(init.credentials, 'include');
});

test('a missing profile is null, not an error', async () => {
  // Expected: the model can rank a gene newer than the description database.
  const { fetchGeneProfile } = load(() => Promise.resolve({ ok: false, status: 404 }));
  assert.equal(await fetchGeneProfile('NOTAGENE', []), null);
});

test('a network failure is null, so the ranking still renders', async () => {
  const { fetchGeneProfile } = load(() => Promise.reject(new Error('offline')));
  assert.equal(await fetchGeneProfile('CFTR', []), null);
});

test('malformed JSON is null rather than a crash', async () => {
  const { fetchGeneProfile } = load(() => Promise.resolve({
    ok: true, json: () => Promise.reject(new SyntaxError('bad json')),
  }));
  assert.equal(await fetchGeneProfile('CFTR', []), null);
});

test('a batch keys profiles by symbol and omits the ones without', async () => {
  const { fetchGeneProfiles } = load(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ profiles: { CFTR: PROFILE } }),
  }));

  const profiles = await fetchGeneProfiles(['CFTR', 'NOTAGENE'], []);

  assert.equal(profiles.size, 1);
  assert.ok(profiles.has('CFTR'));
  assert.equal(profiles.has('NOTAGENE'), false);
});

test('a malformed batch response loses no genes from the ranking', async () => {
  const { fetchGeneProfiles } = load(() => Promise.resolve({
    ok: true, json: () => Promise.reject(new SyntaxError('bad json')),
  }));

  assert.equal((await fetchGeneProfiles(['CFTR'], [])).size, 0);
});

test('frequency reads as words first, with the number as support', () => {
  const { describeFrequency } = load(ok);

  assert.equal(describeFrequency({ frecuencia_pct: 95.5, frecuencia_texto: null }), 'muy frecuente (96%)');
  assert.equal(describeFrequency({ frecuencia_pct: 38.1, frecuencia_texto: null }), 'frecuente (38%)');
  assert.equal(describeFrequency({ frecuencia_pct: 4, frecuencia_texto: null }), 'menos frecuente (4%)');
});

test('frequency falls back to the source wording when there is no percentage', () => {
  const { describeFrequency } = load(ok);

  assert.equal(describeFrequency({ frecuencia_pct: null, frecuencia_texto: 'Muy frecuente' }), 'Muy frecuente');
  assert.equal(describeFrequency({ frecuencia_pct: null, frecuencia_texto: null }), null);
});

test('a ranking is fetched in one request, not one per gene', async () => {
  // The results screen shows up to 50 genes; a request each would spend most of
  // a minute's rate budget on a single page load.
  const calls = [];
  const { fetchGeneProfiles } = load((url, init) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ profiles: { CFTR: PROFILE } }),
    });
  });

  await fetchGeneProfiles(['CFTR', 'SCNN1A', 'DNAH5'], ['HP:0002110']);

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/genes\/batch$/);
  assert.equal(calls[0].init.method, 'POST');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.symbols, ['CFTR', 'SCNN1A', 'DNAH5']);
  assert.deepEqual(body.reported, ['HP:0002110']);
});

test('an empty ranking makes no request at all', async () => {
  let called = false;
  const { fetchGeneProfiles } = load(() => { called = true; return ok(); });

  const profiles = await fetchGeneProfiles([], []);

  assert.equal(called, false);
  assert.equal(profiles.size, 0);
});

test('a failed batch leaves the ranking renderable', async () => {
  const { fetchGeneProfiles } = load(() => Promise.reject(new Error('offline')));
  assert.equal((await fetchGeneProfiles(['CFTR'], [])).size, 0);
});

// --- research links ---------------------------------------------------------

test('the gene links to GeneCards by symbol and to its own OMIM entry', () => {
  const { geneReferenceLinks } = load(ok);
  const urls = geneReferenceLinks('TCF4', '602272').map((l) => l.url);
  assert.deepEqual(urls, [
    'https://www.genecards.org/cgi-bin/carddisp.pl?gene=TCF4',
    'https://www.omim.org/entry/602272',
  ]);
});

test('a gene without an OMIM entry still gets GeneCards, and no OMIM link', () => {
  // Linking one of its disease numbers instead would open the wrong page.
  const { geneReferenceLinks } = load(ok);
  for (const missing of [null, undefined, '']) {
    const links = geneReferenceLinks('DUX4L1', missing);
    assert.deepEqual(links.map((l) => l.label), ['GeneCards']);
  }
});

test('only a six-digit MIM number becomes an OMIM link', () => {
  const { omimUrl } = load(ok);
  assert.equal(omimUrl('610954'), 'https://www.omim.org/entry/610954');
  for (const bad of ['', '61095', 'OMIM:610954', '610954/', null]) {
    assert.equal(omimUrl(bad), null, `${bad} made a link`);
  }
});

test('a curated summary loses its trailing provenance note', () => {
  const { stripProvenance } = load(ok);
  assert.equal(stripProvenance('Codifica una proteína. [provided by RefSeq, Jul 2008]'), 'Codifica una proteína.');
  assert.equal(stripProvenance('Codifica una proteína. (proporcionado por RefSeq)'), 'Codifica una proteína.');
});

test('a score under 0.01 reads as low, never as a number', () => {
  const { formatScore } = load(ok);
  assert.equal(formatScore(0), 'bajo');
  assert.equal(formatScore(0.0099), 'bajo');
  assert.equal(formatScore(0.01), '0.010');
  assert.equal(formatScore(0.37), '0.370');
});

