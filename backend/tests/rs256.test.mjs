import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const HS256_SECRET = 'x'.repeat(48);

process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL = 'https://diagnosticar.infra.cluster.qb.fcen.uba.ar';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/test';
process.env.JWT_ACCESS_SECRET = HS256_SECRET;
process.env.JWT_REFRESH_SECRET = 'y'.repeat(48);
process.env.JWT_ACCESS_PRIVATE_KEY = privateKey;
process.env.JWT_ACCESS_PUBLIC_KEY = publicKey;

const { signAccessToken, verifyAccessToken, signRefreshToken, verifyRefreshToken } =
  await import('../dist/services/authService.js');
const { JWT_ACCESS_ALGORITHM } = await import('../dist/config.js');

const USER = { id: 'a1b2c3', role: 'user', token_version: 1 };

test('a keypair in the environment selects RS256', () => {
  assert.equal(JWT_ACCESS_ALGORITHM, 'RS256');
});

test('access tokens are signed with RS256', () => {
  const header = JSON.parse(
    Buffer.from(signAccessToken(USER).split('.')[0], 'base64url').toString('utf8'),
  );
  assert.equal(header.alg, 'RS256');
});

test('a token this service signed verifies, with its claims intact', () => {
  const decoded = verifyAccessToken(signAccessToken(USER));
  assert.equal(decoded.sub, USER.id);
  assert.equal(decoded.role, USER.role);
  assert.equal(decoded.tokenVersion, USER.token_version);
});

test('the public key alone verifies an access token', () => {
  // This is the property the whole change exists for: brainy holds only the
  // public half and can still check a token.
  const decoded = jwt.verify(signAccessToken(USER), publicKey, { algorithms: ['RS256'] });
  assert.equal(decoded.sub, USER.id);
});

test('the public key alone cannot mint a usable token', () => {
  assert.throws(() => jwt.sign({ sub: 'attacker' }, publicKey, { algorithm: 'RS256' }));
});

test('a token signed by a different keypair is rejected', () => {
  const other = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const forged = jwt.sign({ sub: 'attacker', role: 'admin' }, other.privateKey, {
    algorithm: 'RS256',
  });
  assert.equal(verifyAccessToken(forged), null);
});

test('an alg:none token is rejected', () => {
  const forged = jwt.sign({ sub: 'attacker', role: 'admin' }, '', { algorithm: 'none' });
  assert.equal(verifyAccessToken(forged), null);
});

test('an HS256 token signed with the public key is rejected', () => {
  // The classic algorithm-confusion attack: the public key is public, so if a
  // verifier honoured the token's own alg an attacker could sign with it as a
  // shared secret. Pinning algorithms defeats this.
  const forged = jwt.sign({ sub: 'attacker', role: 'admin' }, publicKey, {
    algorithm: 'HS256',
  });
  assert.equal(verifyAccessToken(forged), null);
});

test('an HS256 token signed with the old secret is rejected by default', () => {
  // Legacy acceptance is opt-in; without it the cutover invalidates old
  // sessions rather than leaving the previous secret usable.
  const legacy = jwt.sign({ sub: USER.id, role: 'user' }, HS256_SECRET, {
    algorithm: 'HS256',
  });
  assert.equal(verifyAccessToken(legacy), null);
});

test('a tampered payload is rejected', () => {
  const [header, , signature] = signAccessToken(USER).split('.');
  const elevated = Buffer.from(
    JSON.stringify({ sub: USER.id, role: 'admin', tokenVersion: 1 }),
  ).toString('base64url');
  assert.equal(verifyAccessToken(`${header}.${elevated}.${signature}`), null);
});

test('an expired token is rejected', () => {
  const expired = jwt.sign({ sub: USER.id }, privateKey, {
    algorithm: 'RS256',
    expiresIn: '-1s',
  });
  assert.equal(verifyAccessToken(expired), null);
});

test('refresh tokens stay HS256', () => {
  // Only this service ever sees a refresh token, so a keypair buys nothing.
  const header = JSON.parse(
    Buffer.from(signRefreshToken(USER).split('.')[0], 'base64url').toString('utf8'),
  );
  assert.equal(header.alg, 'HS256');
  assert.equal(verifyRefreshToken(signRefreshToken(USER)).sub, USER.id);
});
