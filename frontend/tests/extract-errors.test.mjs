import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/**
 * What a person reads when free-text analysis is refused. The gateway names
 * the limit in `detail.error`; each one gets its own message, and the two that
 * can last hours point to the symptom search, which spends nothing.
 */
const source = readFileSync(new URL('../src/lib/extract-errors.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { mensajeErrorExtraccion, esperaLegible } = new Function(
  `${js.replace(/^export /gm, '')}; return { mensajeErrorExtraccion, esperaLegible };`,
)();

const refused = (error, retry_after) => ({ detail: { error, retry_after, message: 'x' } });

test('the global budget says it is the service, when it lifts, and offers the search', () => {
  const text = mensajeErrorExtraccion(429, refused('global-budget', 3 * 3600));
  assert.match(text, /alcanzó su límite de uso/);
  assert.match(text, /3 horas/);
  assert.match(text, /buscador/);
});

test('the per-user limit says it is the person, not the service', () => {
  const text = mensajeErrorExtraccion(429, refused('user-rate-limit', 1200));
  assert.match(text, /Llegaste al límite/);
  assert.match(text, /20 minutos/);
  assert.match(text, /buscador/);
});

test('a 429 without a named limit keeps the short message', () => {
  assert.match(mensajeErrorExtraccion(429, { detail: 'Rate limit exceeded' }), /muchas consultas seguidas/);
});

test('session, busy and unknown failures', () => {
  assert.match(mensajeErrorExtraccion(401, {}), /sesión expiró/);
  assert.match(mensajeErrorExtraccion(503, {}), /ocupado/);
  assert.equal(mensajeErrorExtraccion(500, { detail: 'extraction-failed' }), 'extraction-failed');
  assert.equal(mensajeErrorExtraccion(500, null), 'No pudimos analizar el texto.');
  // A structured detail must never reach the screen as "[object Object]".
  assert.equal(mensajeErrorExtraccion(422, { detail: [{ loc: ['body'] }] }), 'No pudimos analizar el texto.');
});

test('waits read as a person would say them', () => {
  assert.equal(esperaLegible(30), 'un minuto');
  assert.equal(esperaLegible(600), '10 minutos');
  assert.equal(esperaLegible(3600), 'una hora');
  assert.equal(esperaLegible(5 * 3600), '5 horas');
  assert.equal(esperaLegible(86400), 'un día');
  assert.equal(esperaLegible(3 * 86400), '3 días');
});
