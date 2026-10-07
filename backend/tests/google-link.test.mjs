import './helpers/env.mjs';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import crypto from 'node:crypto';
import {
    databaseAvailable, skipReason, startServer, createClient,
    seedUser, authenticateClient, deleteUser, closePool,
} from './helpers/server.mjs';

/**
 * Emails are not verified at sign-up, so an account's password may have been
 * set by someone who registered another person's address first. When the
 * owner signs in with Google and the account gets linked, that password and
 * every session opened with it must stop working.
 */

const available = await databaseAvailable();
const skip = available ? false : skipReason();

let server;

before(async () => {
    if (!available) return;
    server = await startServer();
});

after(async () => {
    if (!available) return;
    await server.close();
    await closePool();
});

test('linking Google retires the password and the sessions opened with it', { skip }, async (t) => {
    const squatter = await seedUser({ password: 'the-squatters-password' });
    t.after(() => deleteUser(squatter.id));
    const session = authenticateClient(createClient(server.baseUrl), squatter);
    assert.equal((await session.get('/api/auth/me')).status, 200);

    const { linkGoogleAccount } = await import('../dist/repositories/userRepository.js');
    const { hashPassword } = await import('../dist/services/authService.js');
    const linked = await linkGoogleAccount(
        squatter.id,
        `google-${crypto.randomUUID()}`,
        null,
        await hashPassword(crypto.randomBytes(32).toString('hex')),
    );
    assert.ok(linked?.google_id);

    const login = await createClient(server.baseUrl).post('/api/auth/login', {
        email: squatter.email,
        password: 'the-squatters-password',
    });
    assert.equal(login.status, 401, 'the old password still signs in');
    // 403: the token is well formed but its version was revoked.
    assert.equal((await session.get('/api/auth/me')).status, 403, 'the old session still works');
    const refresh = await session.post('/api/auth/refresh');
    assert.equal(refresh.status, 403, 'the old refresh token still renews');
});

test("linking Google clears an invited account's temporary-password requirement", { skip }, async (t) => {
    const { createInvitedUser, linkGoogleAccount } = await import('../dist/repositories/userRepository.js');
    const { hashPassword } = await import('../dist/services/authService.js');
    const invited = await createInvitedUser(
        `invited-${crypto.randomUUID()}@example.test`,
        await hashPassword('temporary-password-123'),
        'user',
        'Invitada',
        null,
    );
    t.after(() => deleteUser(invited.id));
    assert.equal(invited.must_change_password, true);

    const linked = await linkGoogleAccount(invited.id, `google-${crypto.randomUUID()}`, null, await hashPassword('x'.repeat(40)));
    assert.equal(linked.must_change_password, false);
});
