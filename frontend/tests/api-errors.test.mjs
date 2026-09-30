import assert from 'node:assert/strict';
import test from 'node:test';
import { importTs } from './helpers/ts-module.mjs';

/**
 * What a person reads when a request fails. The rule under test: whatever the
 * server sent -- English, a FastAPI `detail` array or object, an HTML page from
 * a proxy -- the screen gets our own Spanish text, and a failure that is not a
 * closed session never sends anyone to log in again.
 */

const { ApiError, readApiError, toApiError, errorMessage, isSessionError, waitText } = await importTs(
  'lib/extract-errors.ts',
  'lib/api-errors.ts',
);

const respond = (status, body, headers = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

const RAW = /Failed to fetch|object Object|Invalid|Unauthorized|Internal|Service not ready|model not loaded|HTTP \d|extraction-failed|<html/i;

test('the server wording never reaches the screen', async () => {
  const cases = [
    [respond(400, { error: 'Invalid payload', code: 'invalid_payload' }), 'signup'],
    [respond(401, { error: 'Invalid credentials', code: 'invalid_credentials' }), 'login'],
    [respond(500, { error: 'Internal server error', code: 'internal' }), 'save'],
    [respond(503, { detail: 'Service not ready — model not loaded' }), 'rank_genes'],
    [respond(422, { detail: "Invalid HPO ID: 'HP:9'" }), 'rank_genes'],
    [respond(422, { detail: { error: 'no-known-hpo-ids', unknown_hpo_ids: ['HP:1'] } }), 'rank_genes'],
    [respond(422, { detail: [{ loc: ['body', 'hpo_ids'], msg: 'x' }] }), 'rank_genes'],
    [respond(500, { detail: 'extraction-failed' }), 'extract'],
    [respond(502, '<html><body>Bad Gateway</body></html>'), 'patients_list'],
    [respond(404, { error: 'Not found', code: 'not_found' }), undefined],
  ];
  for (const [res, context] of cases) {
    const text = errorMessage(await readApiError(res), context);
    assert.ok(text.length > 20, `${res.status} ${context}: "${text}"`);
    assert.doesNotMatch(text, RAW, `${res.status} ${context}: "${text}"`);
  }
});

test('a dropped connection is named as such, per browser wording', () => {
  for (const message of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
    const text = errorMessage(new TypeError(message));
    assert.match(text, /No pudimos conectarnos/);
    assert.doesNotMatch(text, RAW);
  }
  assert.match(errorMessage(new TypeError('Failed to fetch'), 'rank_genes'), /síntomas cargados siguen acá/);
  assert.match(errorMessage(new TypeError('Failed to fetch'), 'extract'), /buscador/);
});

test('an aborted request shows nothing', () => {
  const abort = new DOMException('The user aborted a request.', 'AbortError');
  assert.equal(errorMessage(abort), '');
});

test('a non-JSON success body is a bad response, not a crash', () => {
  assert.equal(toApiError(new SyntaxError("Unexpected token '<'")).kind, 'bad_response');
});

test('the code comes from `code` or from a FastAPI detail object', async () => {
  assert.equal((await readApiError(respond(403, { error: 'x', code: 'csrf_mismatch' }))).code, 'csrf_mismatch');
  assert.equal(
    (await readApiError(respond(429, { detail: { error: 'global-budget', retry_after: 60 } }))).code,
    'global-budget',
  );
  assert.equal((await readApiError(respond(422, { detail: [{ loc: [] }] }))).code, null);
});

test('only a lapsed session is a session error', async () => {
  const session = [
    respond(401, { error: 'Unauthorized', code: 'unauthenticated' }),
    respond(403, { error: 'Forbidden', code: 'session_expired' }),
    respond(403, { error: 'Token revoked', code: 'session_revoked' }),
    respond(401, 'Unauthorized'),
  ];
  for (const res of session) assert.equal(isSessionError(await readApiError(res)), true, `${res.status}`);

  const notSession = [
    respond(401, { error: 'Invalid credentials', code: 'invalid_credentials' }),
    respond(403, { error: 'CSRF token mismatch', code: 'csrf_mismatch' }),
    respond(403, { error: 'Password change required', code: 'PASSWORD_CHANGE_REQUIRED' }),
    respond(429, { error: 'Too many requests', code: 'rate_limited' }),
    respond(500, { error: 'Internal server error' }),
  ];
  for (const res of notSession) assert.equal(isSessionError(await readApiError(res)), false, `${res.status}`);
  assert.equal(isSessionError(new TypeError('Failed to fetch')), false);
});

test('the login says which of its failures happened', async () => {
  assert.match(
    errorMessage(await readApiError(respond(401, { code: 'invalid_credentials' })), 'login'),
    /email o la contraseña no son correctos/,
  );
  const limited = await readApiError(respond(429, { code: 'rate_limited', retryAfter: 900 }, { 'Retry-After': '900' }));
  assert.match(errorMessage(limited, 'login'), /muchos intentos.*15 minutos/);
  assert.match(errorMessage(new TypeError('Failed to fetch'), 'login'), /No pudimos conectarnos/);
});

test('change-password tells a wrong temporary password from a closed session', async () => {
  const wrong = await readApiError(respond(400, { code: 'invalid_current_password' }));
  assert.match(errorMessage(wrong, 'change_password'), /contraseña temporal no es correcta/);
  assert.equal(isSessionError(wrong), false);
  assert.match(errorMessage(await readApiError(respond(400, { code: 'weak_password' })), 'change_password'), /12 caracteres/);
});

test('a structured signup 400 points at the field', async () => {
  assert.match(errorMessage(await readApiError(respond(400, { code: 'invalid_payload', field: 'password' })), 'signup'), /contraseña/);
  assert.match(errorMessage(await readApiError(respond(400, { code: 'invalid_payload', field: 'email' })), 'signup'), /email/);
});

test('the model and extraction failures keep their own advice', async () => {
  assert.match(
    errorMessage(await readApiError(respond(422, { detail: { error: 'no-known-hpo-ids' } })), 'rank_genes'),
    /Ninguno de los síntomas/,
  );
  assert.match(errorMessage(await readApiError(respond(503, { detail: 'x' })), 'rank_genes'), /se está iniciando/);
  const budget = await readApiError(respond(429, { detail: { error: 'global-budget', retry_after: 7200 } }));
  assert.match(errorMessage(budget, 'extract'), /alcanzó su límite de uso/);
});

test('waits read as a person would say them', () => {
  assert.equal(waitText(null), 'en unos minutos');
  assert.equal(waitText(10), 'en unos segundos');
  assert.equal(waitText(600), 'en 10 minutos');
  assert.equal(waitText(3600), 'en una hora');
});

test('ApiError keeps the server text for the console only', () => {
  const e = new ApiError('http', { status: 500, serverText: 'HTTP 500: boom' });
  assert.equal(e.message, 'HTTP 500: boom');
  assert.doesNotMatch(errorMessage(e), /boom/);
});
