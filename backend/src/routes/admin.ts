import crypto from 'crypto';
import { Router } from 'express';
import {
    authenticate,
    requireFreshAccessToken,
    blockUntilPasswordChanged,
    type AuthRequest,
} from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { internalError, sendError } from '../utils/httpErrors.js';
import { hashPassword } from '../services/authService.js';
import {
    getUserByEmail,
    createInvitedUser,
    listStaff,
    setUserRole,
} from '../repositories/userRepository.js';
import {
    RELEASE_VERSION,
    RELEASE_COMMIT,
    RELEASE_BUILT_AT,
    NODE_ENV,
} from '../config.js';
import {
    getTotals,
    getDiagnosesPerDay,
    getSignupsPerDay,
    getTopSpecialties,
    getTopPhenotypes,
    getConfidenceHistogram,
    getCountries,
    getAuthProviderSplit,
} from '../repositories/metricsRepository.js';

const router = Router();

/**
 * Backoffice API. Every route is aggregate-only: nothing here can return a
 * patient row, a clinical history, an email, an IP or a user agent. That is
 * enforced in `metricsRepository`, where the aggregation happens in SQL, so
 * the data never reaches this layer to be leaked by accident.
 *
 * The guard order matters and is the same on every route:
 *   authenticate            — a valid, unexpired access token
 *   requireFreshAccessToken — loads the DB row, rejects revoked tokens
 *   requireAdmin            — reads role from that row, never from the JWT
 */
const adminGuards = [
    rateLimit({ windowMs: 60_000, max: 60 }),
    authenticate,
    requireFreshAccessToken,
    blockUntilPasswordChanged,
    requireAdmin,
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A temporary password the inviter reads aloud or pastes into a chat. Drawn
 * from crypto.randomInt rather than Math.random, and from an alphabet without
 * look-alike characters so it survives being transcribed by hand.
 */
function generateTemporaryPassword(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 20; i += 1) {
        out += alphabet[crypto.randomInt(alphabet.length)];
    }
    return out;
}

/** Clamp a caller-supplied window to something a query can afford. */
function readDays(raw: unknown, fallback: number): number {
    const n = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, 1), 365);
}

router.get('/overview', ...adminGuards, async (req: AuthRequest, res) => {
    try {
        const days = readDays(req.query.days, 30);
        const [totals, perDay, signups, providers] = await Promise.all([
            getTotals(),
            getDiagnosesPerDay(days),
            getSignupsPerDay(days),
            getAuthProviderSplit(),
        ]);
        res.json({ totals, diagnosesPerDay: perDay, signupsPerDay: signups, authProviders: providers, days });
    } catch (error) {
        console.error('[admin] overview failed', (error as Error)?.message);
        internalError(res);
    }
});

router.get('/insights', ...adminGuards, async (req: AuthRequest, res) => {
    try {
        const [specialties, phenotypes, confidence, countries] = await Promise.all([
            getTopSpecialties(12),
            getTopPhenotypes(15),
            getConfidenceHistogram(),
            getCountries(12),
        ]);
        res.json({ specialties, phenotypes, confidence, countries });
    } catch (error) {
        console.error('[admin] insights failed', (error as Error)?.message);
        internalError(res);
    }
});

/**
 * What is actually running. The values come from the image, not from the repo
 * or the node's deploy state file, so this reports the truth even if someone
 * started a container by hand.
 */
router.get('/release', ...adminGuards, async (_req: AuthRequest, res) => {
    res.json({
        version: RELEASE_VERSION,
        commit: RELEASE_COMMIT,
        builtAt: RELEASE_BUILT_AT,
        environment: NODE_ENV,
        startedAt: new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        node: process.version,
    });
});

/**
 * Staff list. Emails appear here because an admin managing other admins needs
 * to know who they are — this is the one place in the backoffice that is not
 * anonymous, and it is limited to accounts with the admin role.
 */
router.get('/staff', ...adminGuards, async (_req: AuthRequest, res) => {
    try {
        const staff = await listStaff();
        res.json({
            staff: staff.map((u) => ({
                id: u.id,
                email: u.email,
                fullName: u.full_name,
                organization: u.organization,
                status: u.status,
                mustChangePassword: Boolean(u.must_change_password),
                createdAt: (u as unknown as { created_at?: string }).created_at ?? null,
                lastLoginAt: (u as unknown as { last_login_at?: string }).last_login_at ?? null,
            })),
        });
    } catch (error) {
        console.error('[admin] staff list failed', (error as Error)?.message);
        internalError(res);
    }
});

/**
 * Invite an admin by creating the account outright.
 *
 * The temporary password is returned exactly once, in this response, and is
 * never stored in plaintext or logged. The inviter passes it to the invitee out
 * of band; the account can do nothing but change it until they do.
 *
 * Rate limited harder than the read routes: this one writes, and it is the
 * route that would be abused to enumerate which addresses already have
 * accounts.
 */
router.post(
    '/staff',
    rateLimit({ windowMs: 60 * 60_000, max: 10 }),
    authenticate,
    requireFreshAccessToken,
    blockUntilPasswordChanged,
    requireAdmin,
    async (req: AuthRequest, res) => {
        try {
            const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
            const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim().slice(0, 255) : null;
            const organization =
                typeof req.body?.organization === 'string' ? req.body.organization.trim().slice(0, 255) : null;

            if (!EMAIL_RE.test(rawEmail) || rawEmail.length > 255) {
                return sendError(res, 400, 'invalid_email', 'A valid email is required');
            }

            const existing = await getUserByEmail(rawEmail);
            if (existing) {
                // Deliberately explicit: the caller is already an authenticated
                // admin, so this leaks nothing they could not learn from the
                // staff list, and silently doing nothing would be worse.
                return sendError(res, 409, 'email_taken', 'An account with that email already exists');
            }

            const temporaryPassword = generateTemporaryPassword();
            const created = await createInvitedUser(
                rawEmail,
                await hashPassword(temporaryPassword),
                'admin',
                fullName,
                organization,
            );

            console.warn('[admin] staff invited', { by: req.userRecord?.id, newUserId: created.id });

            res.status(201).json({
                user: { id: created.id, email: created.email, fullName: created.full_name },
                temporaryPassword,
            });
        } catch (error) {
            console.error('[admin] invite failed', (error as Error)?.message);
            internalError(res);
        }
    },
);

/**
 * Revoke an admin by demoting them to a normal user rather than deleting the
 * account: deleting cascades to `patients` and `diagnoses`, which would destroy
 * clinical records as a side effect of a permissions change.
 */
router.post(
    '/staff/:id/revoke',
    rateLimit({ windowMs: 60 * 60_000, max: 20 }),
    authenticate,
    requireFreshAccessToken,
    blockUntilPasswordChanged,
    requireAdmin,
    async (req: AuthRequest, res) => {
        try {
            const targetId = String(req.params.id);
            if (!UUID_RE.test(targetId)) {
                return sendError(res, 404, 'not_found', 'Not found');
            }
            if (targetId === req.userRecord?.id) {
                return sendError(res, 400, 'cannot_revoke_self', 'You cannot revoke your own admin access');
            }

            const staff = await listStaff();
            if (!staff.some((u) => u.id === targetId)) {
                return sendError(res, 404, 'not_found', 'Not found');
            }
            if (staff.length <= 1) {
                return sendError(res, 400, 'last_admin', 'Refusing to remove the last admin');
            }

            await setUserRole(targetId, 'user');
            console.warn('[admin] staff revoked', { by: req.userRecord?.id, targetId });
            res.json({ ok: true });
        } catch (error) {
            console.error('[admin] revoke failed', (error as Error)?.message);
            internalError(res);
        }
    },
);

export default router;
