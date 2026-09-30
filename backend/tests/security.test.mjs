import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL = 'https://diagnosticar.infra.cluster.qb.fcen.uba.ar';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/test';
process.env.JWT_ACCESS_SECRET = 'x'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'y'.repeat(48);

const { hashToken } = await import('../dist/utils/tokens.js');
const { enforceOrigin, enforceCsrf, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } =
  await import('../dist/middleware/csrfMiddleware.js');
const { rateLimit } = await import('../dist/middleware/rateLimit.js');

function mockReq({ method = 'POST', headers = {}, cookies = {}, ip = '1.1.1.1', path = '/api/x' } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { method, headers: lower, cookies, ip, path, get: (h) => lower[h.toLowerCase()] };
}

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

function run(mw, req) {
  const res = mockRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

const ORIGIN = 'https://diagnosticar.infra.cluster.qb.fcen.uba.ar';

test('hashToken is deterministic sha256 hex', () => {
  const a = hashToken('abc');
  assert.equal(a, hashToken('abc'));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, hashToken('abd'));
});

test('hashToken does not leak the plaintext', () => {
  assert.ok(!hashToken('secret-token').includes('secret'));
});

test('enforceOrigin allows the configured origin', () => {
  const { nextCalled } = run(enforceOrigin, mockReq({ headers: { origin: ORIGIN } }));
  assert.equal(nextCalled, true);
});

test('enforceOrigin rejects a foreign origin with 403', () => {
  const { res, nextCalled } = run(enforceOrigin, mockReq({ headers: { origin: 'https://evil.example' } }));
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'invalid_origin');
});

test('enforceOrigin ignores safe methods', () => {
  const { nextCalled } = run(enforceOrigin, mockReq({ method: 'GET', headers: { origin: 'https://evil.example' } }));
  assert.equal(nextCalled, true);
});

test('enforceOrigin falls back to referer', () => {
  const { res } = run(enforceOrigin, mockReq({ headers: { referer: 'https://evil.example/x' } }));
  assert.equal(res.statusCode, 403);
});

test('enforceCsrf skips unauthenticated requests', () => {
  const { nextCalled } = run(enforceCsrf, mockReq());
  assert.equal(nextCalled, true);
});

test('enforceCsrf rejects authenticated request without token', () => {
  const req = mockReq({ cookies: { access_token: 'a' } });
  const { res, nextCalled } = run(enforceCsrf, req);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'csrf_mismatch');
});

test('enforceCsrf rejects mismatched token', () => {
  const req = mockReq({
    cookies: { access_token: 'a', [CSRF_COOKIE_NAME]: 'aaa' },
    headers: { [CSRF_HEADER_NAME]: 'bbb' },
  });
  const { res } = run(enforceCsrf, req);
  assert.equal(res.statusCode, 403);
});

test('enforceCsrf accepts matching token', () => {
  const req = mockReq({
    cookies: { access_token: 'a', [CSRF_COOKIE_NAME]: 'same' },
    headers: { [CSRF_HEADER_NAME]: 'same' },
  });
  const { nextCalled } = run(enforceCsrf, req);
  assert.equal(nextCalled, true);
});

test('rateLimit blocks past the max and sets Retry-After', () => {
  const mw = rateLimit({ windowMs: 60000, max: 2, keyGenerator: () => 'k-block' });
  assert.equal(run(mw, mockReq()).nextCalled, true);
  assert.equal(run(mw, mockReq()).nextCalled, true);
  const third = run(mw, mockReq());
  assert.equal(third.nextCalled, false);
  assert.equal(third.res.statusCode, 429);
  assert.ok(third.res.headers['Retry-After']);
  assert.equal(third.res.body.code, 'rate_limited');
  assert.equal(third.res.body.retryAfter, Number(third.res.headers['Retry-After']));
});

test('rateLimit keeps a route-specific code and message', () => {
  const mw = rateLimit({ windowMs: 60000, max: 1, keyGenerator: () => 'k-code', message: 'Esperá.', code: 'custom' });
  run(mw, mockReq());
  const { res } = run(mw, mockReq());
  assert.equal(res.body.error, 'Esperá.');
  assert.equal(res.body.code, 'custom');
});

test('rateLimit isolates distinct keys', () => {
  const mw = rateLimit({ windowMs: 60000, max: 1, keyGenerator: (r) => r.ip });
  assert.equal(run(mw, mockReq({ ip: '10.0.0.1' })).nextCalled, true);
  assert.equal(run(mw, mockReq({ ip: '10.0.0.2' })).nextCalled, true);
  assert.equal(run(mw, mockReq({ ip: '10.0.0.1' })).nextCalled, false);
});

test('rateLimit resets after the window elapses', async () => {
  const mw = rateLimit({ windowMs: 40, max: 1, keyGenerator: () => 'k-reset' });
  assert.equal(run(mw, mockReq()).nextCalled, true);
  assert.equal(run(mw, mockReq()).nextCalled, false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(run(mw, mockReq()).nextCalled, true);
});
