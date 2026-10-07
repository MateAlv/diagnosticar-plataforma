import './helpers/env.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { before, after } from 'node:test';
import {
    databaseAvailable, skipReason, startServer, createClient,
    seedUser, authenticateClient, deleteUser, closePool,
} from './helpers/server.mjs';

/**
 * The error contract the browser relies on: every failure is JSON with a
 * stable `code`, so the frontend can show its own Spanish message instead of
 * whatever text the server happened to use, and no body carries internals.
 */

const available = await databaseAvailable();
const skip = available ? false : skipReason();

let server;
let owner;
let client;

before(async () => {
    if (!available) return;
    server = await startServer();
    owner = await seedUser();
    client = authenticateClient(createClient(server.baseUrl), owner);
});

after(async () => {
    if (!available) return;
    await deleteUser(owner.id);
    await server.close();
    await closePool();
});

test('an unknown /api route answers JSON, not Express\'s HTML page', { skip }, async () => {
    for (const [method, path] of [['GET', '/api/no-such-route'], ['POST', '/api/patients/x/y/z/w']]) {
        const res = await client.raw(method, path, method === 'POST' ? { body: {} } : {});
        assert.equal(res.status, 404, `${method} ${path}`);
        assert.equal(res.json?.code, 'not_found', `${method} ${path}: ${res.text}`);
    }
});

test('malformed JSON is invalid_json, an oversized body is payload_too_large', { skip }, async () => {
    const bad = await client.raw('POST', '/api/patients', {
        body: '{"nombre":',
        headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, 'invalid_json');

    const big = await client.post('/api/patients', { nombre: 'x', historiaClinica: 'a'.repeat(1_100_000) });
    assert.equal(big.status, 413);
    assert.equal(big.json.code, 'payload_too_large');
});

test('a body-parser 4xx keeps its status instead of turning into a 500', { skip }, async () => {
    const res = await client.raw('POST', '/api/patients', {
        body: '{}',
        headers: { 'Content-Type': 'application/json; charset=klingon' },
    });
    assert.equal(res.status, 415);
    assert.equal(res.json.code, 'bad_request');
});

test('CSRF and origin failures carry their own codes', { skip }, async () => {
    const csrf = await client.post('/api/patients', { nombre: 'x' }, { sendCsrf: false });
    assert.equal(csrf.json.code, 'csrf_mismatch');

    const origin = await client.post('/api/patients', { nombre: 'x' }, { headers: { Origin: 'https://evil.example' } });
    assert.equal(origin.json.code, 'invalid_origin');
});

test('no session is unauthenticated; a bad token is session_expired', { skip }, async () => {
    const anon = await createClient(server.baseUrl).get('/api/patients');
    assert.equal(anon.status, 401);
    assert.equal(anon.json.code, 'unauthenticated');

    const forged = createClient(server.baseUrl);
    forged.jar.set('access_token', 'not-a-jwt');
    const res = await forged.get('/api/patients');
    assert.equal(res.status, 403);
    assert.equal(res.json.code, 'session_expired');
});

test('a patient payload that fails validation does not echo zod\'s structure', { skip }, async () => {
    const res = await client.post('/api/patients', { nombre: 42, unexpected: true });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.json).sort(), ['code', 'error']);
    assert.equal(res.json.code, 'invalid_request');
});

test('a wrong password is invalid_credentials; a malformed login names the field', { skip }, async () => {
    const anon = createClient(server.baseUrl);
    const wrong = await anon.post('/api/auth/login', { email: owner.email, password: 'definitely-not-it' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.code, 'invalid_credentials');

    const malformed = await anon.post('/api/auth/login', { email: 'not-an-email', password: 'long-enough-1' });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.json.code, 'invalid_payload');
    assert.equal(malformed.json.field, 'email');
});

async function seedUnverified(password) {
    const { createUser } = await import('../dist/repositories/userRepository.js');
    const { hashPassword } = await import('../dist/services/authService.js');
    const email = `stuck-${crypto.randomUUID()}@example.test`;
    const created = await createUser(email, await hashPassword(password), null, 'Stuck', null);
    return { id: created.id, email };
}

test('signing up over a stuck unverified account needs that account\'s password', { skip }, async (t) => {
    const stuck = await seedUnverified('the-owners-password');
    t.after(() => deleteUser(stuck.id));

    const attacker = createClient(server.baseUrl);
    const takeover = await attacker.post('/api/auth/signup', { email: stuck.email, password: 'attacker-password', termsAccepted: true });
    assert.equal(takeover.status, 200);
    assert.equal(takeover.json.code, 'signup_ambiguous');
    assert.equal(takeover.json.user, undefined);
    assert.equal(attacker.jar.has('access_token'), false, 'no session may be issued');

    const { getUserById } = await import('../dist/repositories/userRepository.js');
    assert.equal((await getUserById(stuck.id)).verified, false, 'the account must stay unverified');

    const owner = createClient(server.baseUrl);
    const finished = await owner.post('/api/auth/signup', { email: stuck.email, password: 'the-owners-password', termsAccepted: true });
    assert.equal(finished.status, 200);
    assert.equal(finished.json.user?.email, stuck.email);
});

test('signing up with a taken email gives the same answer as any ambiguous signup', { skip }, async () => {
    const res = await createClient(server.baseUrl).post('/api/auth/signup', { email: owner.email, password: 'whatever-password', termsAccepted: true });
    assert.equal(res.status, 200);
    assert.equal(res.json.code, 'signup_ambiguous');
    assert.equal(res.json.user, undefined);
});

test('logout works without the csrf cookie, and revokes the session', { skip }, async (t) => {
    const leaving = await seedUser();
    t.after(() => deleteUser(leaving.id));
    const browser = authenticateClient(createClient(server.baseUrl), leaving);
    browser.jar.delete('csrf_token');

    const res = await browser.post('/api/auth/logout', {}, { sendCsrf: false });
    assert.equal(res.status, 200, res.text);

    const stale = authenticateClient(createClient(server.baseUrl), leaving);
    const after = await stale.get('/api/patients');
    assert.equal(after.status, 403);
    assert.equal(after.json.code, 'session_revoked');
});

test('logout from a foreign origin is still refused', { skip }, async () => {
    const res = await client.post('/api/auth/logout', {}, { headers: { Origin: 'https://evil.example' } });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, 'invalid_origin');
});
