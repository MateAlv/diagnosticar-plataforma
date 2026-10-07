import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * The version of /terminos the site asks to accept is the one the backend
 * records, and the dev mock uses the same, so accepting behaves alike in all three.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const version = (source) => /HEALTH_DATA_CONSENT_VERSION\s*=\s*["']([^"']+)["']/.exec(source)?.[1];

test('the backend, the dev mock and the site agree on the terms version', () => {
  const backend = version(read('../../backend/src/services/consent.ts'));
  assert.ok(backend);
  assert.equal(version(read('../mocks/server.mjs')), backend);
  const site = /TERMS_VERSION\s*=\s*["']([^"']+)["']/.exec(read('../src/lib/terms.ts'))?.[1];
  assert.equal(site, backend, 'frontend/src/lib/terms.ts must show the version the backend records');
});
