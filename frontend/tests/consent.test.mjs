import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * The dev mock records the consent with the same wording version as the
 * backend, so a sign-up behaves the same in both.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const version = (source) => /HEALTH_DATA_CONSENT_VERSION\s*=\s*["']([^"']+)["']/.exec(source)?.[1];

test('the backend and the dev mock agree on the consent wording', () => {
  const backend = version(read('../../backend/src/services/consent.ts'));
  assert.ok(backend);
  assert.equal(version(read('../mocks/server.mjs')), backend);
});
