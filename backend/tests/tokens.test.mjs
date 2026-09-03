import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, hashPassword, verifyPassword } =
    await import('../dist/services/authService.js');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'paciente@example.test',
    full_name: 'Nombre Real',
    role: 'user',
    token_version: 3,
    password_hash: '$2a$12$notarealhashnotarealhashnotarealhashnotarealhash',
    organization: 'Hospital X',
};

test('access token carries only the claims the API needs', () => {
    const decoded = jwt.decode(signAccessToken(user));
    assert.deepEqual(
        Object.keys(decoded).sort(),
        ['exp', 'iat', 'role', 'sub', 'tokenVersion'],
    );
    assert.equal(decoded.sub, user.id);
    assert.equal(decoded.tokenVersion, 3);
});

test('tokens never embed the password hash, email or name', () => {
    // A JWT is only base64 — anything in the payload is readable by the holder.
    for (const token of [signAccessToken(user), signRefreshToken(user)]) {
        const payload = Buffer.from(token.split('.')[1], 'base64url').toString('utf8');
        assert.ok(!payload.includes(user.password_hash), 'password hash leaked into the token');
        assert.ok(!payload.includes(user.email), 'email leaked into the token');
        assert.ok(!payload.includes(user.full_name), 'full name leaked into the token');
        assert.ok(!payload.includes(user.organization), 'organization leaked into the token');
    }
});

test('refresh token omits the role so it cannot be used to escalate', () => {
    const decoded = jwt.decode(signRefreshToken(user));
    assert.equal(decoded.role, undefined);
    assert.equal(decoded.sub, user.id);
});

test('access and refresh secrets are not interchangeable', () => {
    assert.equal(verifyAccessToken(signRefreshToken(user)), null);
    assert.equal(verifyRefreshToken(signAccessToken(user)), null);
});

test('rejects the alg:none downgrade', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: user.id, role: 'admin', tokenVersion: 3 })).toString('base64url');
    assert.equal(verifyAccessToken(`${header}.${payload}.`), null);
});

test('rejects a token signed with an attacker-chosen secret', () => {
    const forged = jwt.sign({ sub: user.id, role: 'admin', tokenVersion: 3 }, 'attacker-secret', { algorithm: 'HS256' });
    assert.equal(verifyAccessToken(forged), null);
});

test('rejects a payload tampered after signing', () => {
    const token = signAccessToken(user);
    const [header, , signature] = token.split('.');
    const tampered = Buffer.from(JSON.stringify({ sub: user.id, role: 'admin', tokenVersion: 3 })).toString('base64url');
    assert.equal(verifyAccessToken(`${header}.${tampered}.${signature}`), null);
});

test('rejects an expired access token', () => {
    const expired = jwt.sign({ sub: user.id, role: 'user', tokenVersion: 3 }, ACCESS_SECRET, {
        algorithm: 'HS256',
        expiresIn: '-1s',
    });
    assert.equal(verifyAccessToken(expired), null);
});

test('rejects garbage and empty input without throwing', () => {
    for (const bad of ['', 'not.a.token', '...', 'a.b', null, undefined, 'Bearer x']) {
        assert.equal(verifyAccessToken(bad), null);
        assert.equal(verifyRefreshToken(bad), null);
    }
});

test('access tokens expire in 15 minutes and refresh tokens in 7 days', () => {
    const access = jwt.decode(signAccessToken(user));
    const refresh = jwt.decode(signRefreshToken(user));
    assert.equal(access.exp - access.iat, 15 * 60);
    assert.equal(refresh.exp - refresh.iat, 7 * 24 * 60 * 60);
});

test('bumping token_version invalidates previously issued tokens by claim', () => {
    // Revocation is enforced at the DB comparison in requireFreshAccessToken;
    // this pins the claim the check depends on.
    const before = jwt.decode(signAccessToken(user));
    const after = jwt.decode(signAccessToken({ ...user, token_version: 4 }));
    assert.notEqual(before.tokenVersion, after.tokenVersion);
});

test('secrets configured for tests are long enough to resist offline cracking', () => {
    assert.ok(ACCESS_SECRET.length >= 32);
    assert.ok(REFRESH_SECRET.length >= 32);
    assert.notEqual(ACCESS_SECRET, REFRESH_SECRET);
});

test('passwords are bcrypt-hashed with a work factor of at least 12', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.match(hash, /^\$2[aby]\$(1[2-9]|[2-9][0-9])\$/, `weak or unexpected bcrypt hash: ${hash.slice(0, 7)}`);
});

test('the same password produces different hashes (salted)', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
    assert.notEqual(a, b);
    assert.ok(await verifyPassword('same-password', a));
    assert.ok(await verifyPassword('same-password', b));
});

test('verifyPassword rejects the wrong password and near-misses', async () => {
    const hash = await hashPassword('S3cret-passphrase');
    assert.equal(await verifyPassword('s3cret-passphrase', hash), false);
    assert.equal(await verifyPassword('S3cret-passphrase ', hash), false);
    assert.equal(await verifyPassword('', hash), false);
});

test('bcrypt only considers the first 72 bytes — long passwords must not collide silently', async () => {
    // Documented bcrypt limit. If this ever changes the login boundary changes
    // with it, so the behaviour is pinned rather than assumed.
    const base = 'x'.repeat(72);
    const hash = await hashPassword(base);
    assert.ok(await verifyPassword(`${base}EXTRA`, hash), 'bcrypt truncation behaviour changed');
});

test('hashPassword handles unicode passphrases', async () => {
    const pass = 'contraseña-ñandú-🧬-ünïcode';
    const hash = await hashPassword(pass);
    assert.ok(await verifyPassword(pass, hash));
    assert.equal(await verifyPassword('contrasena-nandu-🧬-unicode', hash), false);
});

test('verification token hashing is not reversible to the plaintext', async () => {
    const { hashToken } = await import('../dist/utils/tokens.js');
    const plain = crypto.randomBytes(32).toString('hex');
    const hashed = hashToken(plain);
    assert.match(hashed, /^[0-9a-f]{64}$/);
    assert.ok(!hashed.includes(plain.slice(0, 8)));
});
