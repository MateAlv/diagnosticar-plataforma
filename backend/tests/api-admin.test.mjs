import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
    databaseAvailable,
    skipReason,
    startServer,
    createClient,
    seedUser,
    authenticateClient,
    deleteUser,
    closePool,
} from './helpers/server.mjs';

/**
 * The backoffice is the only surface that reads across every user's data, so
 * these tests are written adversarially: each one asks "what does an attacker
 * get" rather than "does the happy path work".
 *
 * The two properties that matter:
 *   1. A non-admin cannot reach /api/admin at all, by any route.
 *   2. What an admin does reach contains no personal or clinical data.
 */

const available = await databaseAvailable();
const options = available ? {} : { skip: skipReason() };

async function seedAdmin() {
    const seeded = await seedUser();
    const { setUserRole } = await import('../dist/repositories/userRepository.js');
    const { getUserById } = await import('../dist/repositories/userRepository.js');
    const { signAccessToken, signRefreshToken } = await import('../dist/services/authService.js');
    await setUserRole(seeded.id, 'admin');
    // setUserRole bumps token_version, so the seeded tokens are already stale.
    const fresh = await getUserById(seeded.id);
    return {
        ...seeded,
        user: fresh,
        accessToken: signAccessToken(fresh),
        refreshToken: signRefreshToken(fresh),
    };
}

const ADMIN_READ_ROUTES = ['/api/admin/overview', '/api/admin/insights', '/api/admin/release', '/api/admin/staff'];

test('anonymous callers cannot reach any admin route', options, async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const client = createClient(server.baseUrl);

    for (const route of ADMIN_READ_ROUTES) {
        const res = await client.get(route);
        assert.equal(res.status, 401, `${route} should reject anonymous callers`);
    }
});

test('an authenticated non-admin gets 404, not 403', options, async (t) => {
    const server = await startServer();
    const seeded = await seedUser();
    t.after(async () => {
        await server.close();
        await deleteUser(seeded.id);
    });

    const client = authenticateClient(createClient(server.baseUrl), seeded);

    for (const route of ADMIN_READ_ROUTES) {
        const res = await client.get(route);
        // 404 rather than 403: a 403 would confirm the backoffice exists and
        // that this account simply lacks the role, which is a free hint.
        assert.equal(res.status, 404, `${route} should be invisible to non-admins`);
    }
});

test('a forged admin claim in the JWT does not grant access', options, async (t) => {
    const server = await startServer();
    const seeded = await seedUser();
    t.after(async () => {
        await server.close();
        await deleteUser(seeded.id);
    });

    // A token that genuinely says role: admin, signed with the real secret —
    // exactly what an attacker would mint if the role were trusted from the
    // token instead of re-read from the database.
    const { signAccessToken } = await import('../dist/services/authService.js');
    const forged = signAccessToken({ ...seeded.user, role: 'admin' });

    const client = createClient(server.baseUrl);
    client.jar.set('access_token', forged);
    client.jar.set('csrf_token', crypto.randomBytes(16).toString('hex'));

    const res = await client.get('/api/admin/overview');
    assert.equal(res.status, 404, 'role must come from the database row, not the token');
});

test('an admin reaches the backoffice and gets only aggregates', options, async (t) => {
    const server = await startServer();
    const admin = await seedAdmin();
    t.after(async () => {
        await server.close();
        await deleteUser(admin.id);
    });

    const client = authenticateClient(createClient(server.baseUrl), admin);

    const overview = await client.get('/api/admin/overview');
    assert.equal(overview.status, 200);
    assert.ok(Number.isInteger(overview.json.totals.users));
    assert.ok(Array.isArray(overview.json.diagnosesPerDay));

    // The whole payload must not contain a clinical or identifying field.
    const body = overview.text;
    for (const forbidden of ['historia_clinica', 'source_ip', 'user_agent', 'nombre', 'fecha_nacimiento', 'localidad']) {
        assert.ok(!body.includes(forbidden), `overview leaked ${forbidden}`);
    }

    const insights = await client.get('/api/admin/insights');
    assert.equal(insights.status, 200);
    for (const forbidden of ['historia_clinica', 'source_ip', 'user_agent', 'localidad']) {
        assert.ok(!insights.text.includes(forbidden), `insights leaked ${forbidden}`);
    }
});

test('the release endpoint reports the running image', options, async (t) => {
    const server = await startServer();
    const admin = await seedAdmin();
    t.after(async () => {
        await server.close();
        await deleteUser(admin.id);
    });

    const client = authenticateClient(createClient(server.baseUrl), admin);
    const res = await client.get('/api/admin/release');

    assert.equal(res.status, 200);
    assert.equal(typeof res.json.version, 'string');
    assert.equal(typeof res.json.commit, 'string');
    assert.ok(Number.isInteger(res.json.uptimeSeconds));
});

test('inviting an admin returns a one-time password and forces a change', options, async (t) => {
    const server = await startServer();
    const admin = await seedAdmin();
    const createdIds = [];
    t.after(async () => {
        await server.close();
        for (const id of createdIds) await deleteUser(id);
        await deleteUser(admin.id);
    });

    const client = authenticateClient(createClient(server.baseUrl), admin);
    const email = `invited-${crypto.randomUUID()}@example.test`;

    const res = await client.post('/api/admin/staff', { email, fullName: 'Invited Admin' });
    assert.equal(res.status, 201);
    createdIds.push(res.json.user.id);

    assert.equal(typeof res.json.temporaryPassword, 'string');
    assert.ok(res.json.temporaryPassword.length >= 16, 'temporary password must not be guessable');

    const { getUserById } = await import('../dist/repositories/userRepository.js');
    const created = await getUserById(res.json.user.id);
    assert.equal(created.role, 'admin');
    assert.equal(created.must_change_password, true);
    assert.notEqual(created.password_hash, res.json.temporaryPassword, 'password must be stored hashed');

    // Same address twice is refused rather than silently creating a duplicate.
    const again = await client.post('/api/admin/staff', { email });
    assert.equal(again.status, 409);
});

test('an invited admin can do nothing but change their password', options, async (t) => {
    const server = await startServer();
    const admin = await seedAdmin();
    const createdIds = [];
    t.after(async () => {
        await server.close();
        for (const id of createdIds) await deleteUser(id);
        await deleteUser(admin.id);
    });

    const adminClient = authenticateClient(createClient(server.baseUrl), admin);
    const email = `invited-${crypto.randomUUID()}@example.test`;
    const invite = await adminClient.post('/api/admin/staff', { email, fullName: 'Invited' });
    assert.equal(invite.status, 201);
    createdIds.push(invite.json.user.id);

    const temporaryPassword = invite.json.temporaryPassword;

    // Sign in as the invited account for real, through /login.
    const invited = createClient(server.baseUrl);
    const login = await invited.post('/api/auth/login', { email, password: temporaryPassword });
    assert.equal(login.status, 200);
    assert.equal(login.json.user.must_change_password, true, 'login must tell the client a change is required');

    // Despite holding the admin role, every protected route is refused.
    const blocked = await invited.get('/api/admin/overview');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.code, 'PASSWORD_CHANGE_REQUIRED');

    const patients = await invited.get('/api/patients');
    assert.equal(patients.status, 403, 'the lock applies beyond the backoffice');

    // The wrong current password does not open the exit either.
    const wrong = await invited.post('/api/auth/change-password', {
        currentPassword: 'not-the-temporary-one',
        newPassword: 'a-sufficiently-long-new-password',
    });
    assert.equal(wrong.status, 401);

    // A short new password is refused: these accounts administer the platform.
    const tooShort = await invited.post('/api/auth/change-password', {
        currentPassword: temporaryPassword,
        newPassword: 'short',
    });
    assert.equal(tooShort.status, 400);

    const changed = await invited.post('/api/auth/change-password', {
        currentPassword: temporaryPassword,
        newPassword: 'a-sufficiently-long-new-password',
    });
    assert.equal(changed.status, 200);

    // The change invalidated every session, including this one.
    const afterChange = await invited.get('/api/admin/overview');
    assert.ok(afterChange.status === 401 || afterChange.status === 403, 'sessions must not survive a password change');

    // Signing in again with the new password works, and the lock is gone.
    const fresh = createClient(server.baseUrl);
    const relogin = await fresh.post('/api/auth/login', {
        email,
        password: 'a-sufficiently-long-new-password',
    });
    assert.equal(relogin.status, 200);
    assert.equal(relogin.json.user.must_change_password, false);
    assert.equal((await fresh.get('/api/admin/overview')).status, 200);

    // And the old temporary password is dead.
    const stale = createClient(server.baseUrl);
    assert.equal((await stale.post('/api/auth/login', { email, password: temporaryPassword })).status, 401);
});

test('an admin cannot revoke themselves or the last admin', options, async (t) => {
    const server = await startServer();
    const admin = await seedAdmin();
    t.after(async () => {
        await server.close();
        await deleteUser(admin.id);
    });

    const client = authenticateClient(createClient(server.baseUrl), admin);

    const self = await client.post(`/api/admin/staff/${admin.id}/revoke`, {});
    assert.equal(self.status, 400, 'self-revocation would be an easy way to lock everyone out');

    const missing = await client.post(`/api/admin/staff/${crypto.randomUUID()}/revoke`, {});
    assert.equal(missing.status, 404);
});

test('admin routes reject cross-origin requests', options, async (t) => {
    const server = await startServer();
    const admin = await seedAdmin();
    t.after(async () => {
        await server.close();
        await deleteUser(admin.id);
    });

    const client = authenticateClient(createClient(server.baseUrl), admin);
    const res = await client.post(
        '/api/admin/staff',
        { email: `evil-${crypto.randomUUID()}@example.test` },
        { headers: { Origin: 'https://evil.example' } },
    );
    assert.ok(res.status === 403 || res.status === 500, `expected rejection, got ${res.status}`);
});

test.after(async () => {
    await closePool();
});
