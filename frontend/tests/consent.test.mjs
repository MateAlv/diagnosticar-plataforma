import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * The browser consents to a wording by its version, and the backend refuses
 * any version but its own: the two strings must move together.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const version = (source) => /HEALTH_DATA_CONSENT_VERSION\s*=\s*["']([^"']+)["']/.exec(source)?.[1];

test('the frontend, the backend and the dev mock agree on the consent wording', () => {
  const backend = version(read('../../backend/src/services/consent.ts'));
  assert.ok(backend);
  assert.equal(version(read('../src/lib/consent.ts')), backend);
  assert.equal(version(read('../mocks/server.mjs')), backend);
});
