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
 * Rate limiting is easy to add and easy to add wrongly — a limiter keyed on the
 * wrong thing looks identical to a working one until someone abuses it. These
 * tests check the properties that actually matter rather than that a 429 can be
 * produced at all.
 */

const available = await databaseAvailable();
const options = available ? {} : { skip: skipReason() };

test('login is limited per IP and eventually returns 429', options, async (t) => {
    const server = await startServer();
    t.after(() => server.close());
    const client = createClient(server.baseUrl);

    const email = `nobody-${crypto.randomUUID()}@example.test`;
    let saw429 = false;

    // The login limiter is 10 per 15 minutes.
    for (let i = 0; i < 14; i += 1) {
        const res = await client.post('/api/auth/login', { email, password: 'wrong-password-here' });
        if (res.status === 429) {
            saw429 = true;
            assert.ok(res.headers.get('retry-after'), '429 must tell the caller when to retry');
            break;
        }
    }

    assert.ok(saw429, 'repeated failed logins must eventually be rate limited');
});

test('the authenticated limiter keys on the account, not the IP', options, async (t) => {
    const server = await startServer();
    const userA = await seedUser();
    const userB = await seedUser();
    t.after(async () => {
        await server.close();
        await deleteUser(userA.id);
        await deleteUser(userB.id);
    });

    // Both clients come from the same address (127.0.0.1). If the limiter keyed
    // on IP, exhausting A's budget would also lock out B — which is what would
    // happen to everyone behind a hospital NAT.
    const clientA = authenticateClient(createClient(server.baseUrl), userA);
    const clientB = authenticateClient(createClient(server.baseUrl), userB);

    let aLimited = false;
    for (let i = 0; i < 130; i += 1) {
        const res = await clientA.get('/api/patients');
        if (res.status === 429) {
            aLimited = true;
            break;
        }
    }
    assert.ok(aLimited, 'a single account must be limited on reads');

    const bRes = await clientB.get('/api/patients');
    assert.equal(bRes.status, 200, 'a different account from the same IP must not be affected');
});

test('rate limit responses carry Retry-After', options, async (t) => {
    const server = await startServer();
    const user = await seedUser();
    t.after(async () => {
        await server.close();
        await deleteUser(user.id);
    });

    const client = authenticateClient(createClient(server.baseUrl), user);

    let limited = null;
    for (let i = 0; i < 130; i += 1) {
        const res = await client.get('/api/patients');
        if (res.status === 429) {
            limited = res;
            break;
        }
    }

    assert.ok(limited, 'expected to hit the limit');
    const retryAfter = Number(limited.headers.get('retry-after'));
    assert.ok(Number.isFinite(retryAfter) && retryAfter > 0, 'Retry-After must be a positive number of seconds');
});

test.after(async () => {
    await closePool();
});
