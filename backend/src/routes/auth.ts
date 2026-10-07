import { Router, type Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import {
    createGoogleUser,
    createUser,
    getUserByEmail,
    getUserById,
    getUserByGoogleId,
    linkGoogleAccount,
    verifyUser,
    updateUserTokenVersion,
    getUserByVerificationToken,
    setPassword,
    recordHealthDataConsent,
} from '../repositories/userRepository.js';
import {
    hashPassword,
    verifyPassword,
    signAccessToken,
    signRefreshToken,
    verifyRefreshToken,
    verifyAccessToken,
} from '../services/authService.js';
import { authenticate, AuthRequest, requireFreshAccessToken } from '../middleware/authMiddleware.js';
import { HEALTH_DATA_CONSENT_VERSION, publicUser } from '../services/consent.js';
import { CSRF_COOKIE_NAME } from '../middleware/csrfMiddleware.js';
import { rateLimit, userRateLimit } from '../middleware/rateLimit.js';
import { hashToken } from '../utils/tokens.js';
import { logError } from '../utils/logError.js';
import { deleteAccount } from '../repositories/accountRepository.js';
import { stripNullBytes } from '../utils/sanitize.js';
import { internalError, sendError } from '../utils/httpErrors.js';
import { GOOGLE_AUTH_ENABLED, GOOGLE_REDIRECT_URL, IS_PRODUCTION } from '../config.js';
import passport from 'passport';
import { GoogleProfile } from '../services/googleAuth.js';

const router = Router();

const signupSchema = z
    .object({
        email: z.string().email().max(255),
        password: z.string().min(8).max(128),
        fullName: z.string().trim().min(1).max(255).optional().nullable(),
        name: z.string().trim().min(1).max(255).optional().nullable(),
        organization: z.string().trim().min(1).max(255).optional().nullable(),
        // The sign-up form's checkbox: accepting /terminos, recorded with its version.
        termsAccepted: z.literal(true),
    })
    .strict();

const loginSchema = z
    .object({
        email: z.string().email().max(255),
        password: z.string().min(8).max(128),
    })
    .strict();

const verifySchema = z
    .object({
        token: z.string().min(32).max(255),
    })
    .strict();

const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const accessCookieOptions = {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax' as const,
    path: '/',
};

const refreshCookieOptions = {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax' as const,
    path: '/',
};

const csrfCookieOptions = {
    secure: IS_PRODUCTION,
    sameSite: 'lax' as const,
    path: '/',
};

// Ties the Google callback to the browser that started the sign-in, so nobody
// can log a victim into the attacker's account (login CSRF).
const OAUTH_STATE_COOKIE = 'oauth_state';
const oauthStateCookieOptions = {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 10 * 60 * 1000,
};

// Set when the Google sign-in starts from the sign-up form with its checkbox
// ticked, so the account that comes back from Google is recorded as having
// accepted /terminos. Carries the version, never anything about the person.
const TERMS_ACCEPTED_COOKIE = 'terms_accepted';

const signupRateLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
const loginRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const googleRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const passwordChangeRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
// /verify consumes a token from a URL; without a limit it can be brute-forced.
const verifyRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
// /refresh is called by every open tab on a timer, so this is generous — it is
// a ceiling on abuse, not a quota for normal use.
const refreshRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });
const sessionReadRateLimit = userRateLimit({ windowMs: 60 * 1000, max: 60 });
const logoutRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

const changePasswordSchema = z
    .object({
        currentPassword: z.string().min(1).max(200),
        // Longer than the 8 signup requires: these accounts administer the
        // platform, and the password being replaced was chosen by someone else.
        newPassword: z.string().min(12).max(200),
    })
    .refine((v) => v.currentPassword !== v.newPassword, {
        message: 'The new password must differ from the current one',
    });

/** Which field failed, so the form can point at it. Only these two, never zod's text. */
function invalidPayload(res: Response, issues: z.ZodIssue[]) {
    const field = issues[0]?.path[0];
    return sendError(
        res,
        400,
        'invalid_payload',
        'Invalid payload',
        field === 'email' || field === 'password' ? { field } : undefined,
    );
}

const SIGNUP_AMBIGUOUS = {
    message: 'If an account exists, a verification email will be sent.',
    code: 'signup_ambiguous',
} as const;

function setCsrfCookie(res: Response) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE_NAME, token, {
        ...csrfCookieOptions,
        maxAge: REFRESH_TOKEN_MAX_AGE_MS,
    });
}

function googleAuthUnavailable(res: Response) {
    return res.redirect(`${GOOGLE_REDIRECT_URL}?error=google_auth_unavailable`);
}

function extractGoogleProfile(user: unknown): GoogleProfile | null {
    if (!user || typeof user !== 'object') {
        return null;
    }
    return user as GoogleProfile;
}

router.get('/oauth/google', googleRateLimit, (req, res, next) => {
    if (!GOOGLE_AUTH_ENABLED) {
        return googleAuthUnavailable(res);
    }
    const state = crypto.randomBytes(32).toString('hex');
    res.cookie(OAUTH_STATE_COOKIE, state, oauthStateCookieOptions);
    if (req.query.acepto === HEALTH_DATA_CONSENT_VERSION) {
        res.cookie(TERMS_ACCEPTED_COOKIE, HEALTH_DATA_CONSENT_VERSION, oauthStateCookieOptions);
    } else {
        res.clearCookie(TERMS_ACCEPTED_COOKIE, { ...oauthStateCookieOptions, maxAge: undefined });
    }
    return passport.authenticate('google', {
        scope: ['profile', 'email'],
        session: false,
        prompt: 'select_account',
        state,
    })(req, res, next);
});

router.get(
    '/oauth/google/callback',
    googleRateLimit,
    (req, res, next) => {
        if (!GOOGLE_AUTH_ENABLED) {
            return googleAuthUnavailable(res);
        }
        const expected = req.cookies?.[OAUTH_STATE_COOKIE];
        const received = req.query.state;
        res.clearCookie(OAUTH_STATE_COOKIE, { ...oauthStateCookieOptions, maxAge: undefined });
        res.locals.termsAccepted = req.cookies?.[TERMS_ACCEPTED_COOKIE] === HEALTH_DATA_CONSENT_VERSION;
        res.clearCookie(TERMS_ACCEPTED_COOKIE, { ...oauthStateCookieOptions, maxAge: undefined });
        if (
            typeof expected !== 'string' ||
            typeof received !== 'string' ||
            expected.length !== received.length ||
            !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))
        ) {
            return res.redirect(`${GOOGLE_REDIRECT_URL}?error=google_auth_failed`);
        }
        return passport.authenticate('google', {
            session: false,
            failureRedirect: `${GOOGLE_REDIRECT_URL}?error=google_auth_failed`,
        })(req, res, next);
    },
    async (req, res) => {
        try {
            const profile = extractGoogleProfile(req.user);
            if (!profile) {
                return res.redirect(`${GOOGLE_REDIRECT_URL}?error=google_profile_missing`);
            }

            const googleId = profile.id;
            const email = profile.emails?.[0]?.value;
            const fullName = profile.displayName || undefined;
            const avatarUrl = profile.photos?.[0]?.value ?? null;

            if (!email) {
                return res.redirect(`${GOOGLE_REDIRECT_URL}?error=google_email_missing`);
            }

            let user = await getUserByGoogleId(googleId);
            if (!user) {
                const existing = await getUserByEmail(email);
                if (existing) {
                    user = await linkGoogleAccount(existing.id, googleId, avatarUrl);
                }
            }

            if (!user) {
                const passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
                user = await createGoogleUser(email, passwordHash, googleId, fullName, avatarUrl);
            }

            if (!user) {
                return res.redirect(`${GOOGLE_REDIRECT_URL}?error=google_user_missing`);
            }

            if (!user.verified) {
                await verifyUser(user.id);
            }
            if (res.locals.termsAccepted === true) {
                await recordHealthDataConsent(user.id, HEALTH_DATA_CONSENT_VERSION);
            }

            const accessToken = signAccessToken(user);
            const refreshToken = signRefreshToken(user);

            res.cookie('access_token', accessToken, {
                ...accessCookieOptions,
                maxAge: ACCESS_TOKEN_MAX_AGE_MS,
            });
            res.cookie('refresh_token', refreshToken, {
                ...refreshCookieOptions,
                maxAge: REFRESH_TOKEN_MAX_AGE_MS,
            });
            setCsrfCookie(res);

            return res.redirect(GOOGLE_REDIRECT_URL);
        } catch (error) {
            if (!IS_PRODUCTION) {
                logError('[auth] google callback failed', error);
            }
            return res.redirect(`${GOOGLE_REDIRECT_URL}?error=google_auth_failed`);
        }
    }
);

router.post('/signup', signupRateLimit, async (req, res) => {
    try {
        const parsed = signupSchema.safeParse(req.body);
        if (!parsed.success) {
            return invalidPayload(res, parsed.error.issues);
        }
        const { email, password, fullName, name, organization } = stripNullBytes(parsed.data);
        const safeFullName = fullName ?? name ?? undefined;
        const safeOrganization = organization ?? undefined;

        const existing = await getUserByEmail(email);
        if (existing) {
            // A stuck unverified account is finished and signed in, but only
            // for whoever knows its password: otherwise anyone could sign up
            // with that email and walk into the account.
            if (
                !existing.verified &&
                existing.auth_provider === 'local' &&
                existing.password_hash &&
                (await verifyPassword(password, existing.password_hash))
            ) {
                await verifyUser(existing.id);
                await recordHealthDataConsent(existing.id, HEALTH_DATA_CONSENT_VERSION);
                const accessToken = signAccessToken(existing);
                const refreshToken = signRefreshToken(existing);
                res.cookie('access_token', accessToken, { ...accessCookieOptions, maxAge: ACCESS_TOKEN_MAX_AGE_MS });
                res.cookie('refresh_token', refreshToken, { ...refreshCookieOptions, maxAge: REFRESH_TOKEN_MAX_AGE_MS });
                setCsrfCookie(res);
                return res.json({ user: publicUser((await getUserById(existing.id)) ?? existing) });
            }
            // Same answer whether or not the email is taken, so signup cannot
            // be used to find out who has an account.
            return res.json(SIGNUP_AMBIGUOUS);
        }

        const passwordHash = await hashPassword(password);
        const verificationTokenHash = hashToken(crypto.randomBytes(32).toString('hex'));
        const newUser = await createUser(email, passwordHash, verificationTokenHash, safeFullName, safeOrganization);

        // Auto-verify immediately — email verification is handled separately
        await verifyUser(newUser.id);
        await recordHealthDataConsent(newUser.id, HEALTH_DATA_CONSENT_VERSION);

        const accessToken = signAccessToken(newUser);
        const refreshToken = signRefreshToken(newUser);
        res.cookie('access_token', accessToken, { ...accessCookieOptions, maxAge: ACCESS_TOKEN_MAX_AGE_MS });
        res.cookie('refresh_token', refreshToken, { ...refreshCookieOptions, maxAge: REFRESH_TOKEN_MAX_AGE_MS });
        setCsrfCookie(res);

        res.json({ user: publicUser((await getUserById(newUser.id)) ?? newUser) });
    } catch (error) {
        logError('[auth] request failed', error);
        internalError(res);
    }
});

router.post('/login', loginRateLimit, async (req, res) => {
    try {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
            return invalidPayload(res, parsed.error.issues);
        }
        const { email, password } = parsed.data;
        const user = await getUserByEmail(email);

        if (!user || !(await verifyPassword(password, user.password_hash)) || !user.verified) {
            return sendError(res, 401, 'invalid_credentials', 'Invalid credentials');
        }

        const accessToken = signAccessToken(user);
        const refreshToken = signRefreshToken(user);

        // Set cookies
        res.cookie('access_token', accessToken, {
            ...accessCookieOptions,
            maxAge: ACCESS_TOKEN_MAX_AGE_MS // 15m
        });

        res.cookie('refresh_token', refreshToken, {
            ...refreshCookieOptions,
            maxAge: REFRESH_TOKEN_MAX_AGE_MS // 7d
        });
        setCsrfCookie(res);

        res.json({
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                // Drives the forced redirect to /admin/change-password. The
                // server enforces it independently; this only saves the client
                // from discovering it by being refused.
                must_change_password: Boolean(user.must_change_password),
            },
        });
    } catch (error) {
        logError('[auth] request failed', error);
        internalError(res);
    }
});

/**
 * Change your own password. Also the exit from an invited account's
 * `must_change_password` state, so it must be reachable by a user who is
 * otherwise restricted — it sits in auth, not admin, for that reason.
 *
 * Requires the current password even though the session is already
 * authenticated: without that, a borrowed browser tab is enough to take over
 * the account permanently.
 */
router.post(
    '/change-password',
    passwordChangeRateLimit,
    authenticate,
    requireFreshAccessToken,
    async (req: AuthRequest, res) => {
        try {
            const user = req.userRecord;
            if (!user) {
                return sendError(res, 401, 'unauthenticated', 'Unauthorized');
            }

            const parsed = changePasswordSchema.safeParse(req.body);
            if (!parsed.success) {
                return sendError(
                    res,
                    400,
                    'weak_password',
                    'The new password must be at least 12 characters and differ from the current one',
                );
            }
            const { currentPassword, newPassword } = parsed.data;

            // 400, not 401: the session is fine, only the typed password is
            // wrong, and a 401 would read as "signed out" to the client.
            if (!(await verifyPassword(currentPassword, user.password_hash))) {
                return sendError(res, 400, 'invalid_current_password', 'Invalid current password');
            }

            await setPassword(user.id, await hashPassword(newPassword));

            // setPassword bumped token_version, so every session — including
            // this one — is now invalid. Clearing the cookies here makes that
            // visible as a clean sign-out rather than as confusing 403s.
            res.clearCookie('access_token', accessCookieOptions);
            res.clearCookie('refresh_token', refreshCookieOptions);

            console.warn('[auth] password changed', { userId: user.id });
            res.json({ ok: true, reauthenticate: true });
        } catch (error) {
            console.error('[auth] change-password failed', (error as Error)?.message);
            internalError(res);
        }
    },
);

router.post('/verify', verifyRateLimit, async (req, res) => {
    try {
        const parsed = verifySchema.safeParse(req.body);
        if (!parsed.success) {
            return sendError(res, 400, 'invalid_token', 'Invalid token');
        }
        const { token } = parsed.data;
        const user = await getUserByVerificationToken(token);

        if (!user) {
            return sendError(res, 400, 'invalid_token', 'Invalid token');
        }

        await verifyUser(user.id);
        res.json({ message: 'Verified' });
    } catch (error) {
        logError('[auth] request failed', error);
        internalError(res);
    }
});

router.get('/me', sessionReadRateLimit, authenticate, requireFreshAccessToken, async (req: AuthRequest, res) => {
    try {
        const user = req.userRecord ?? (req.user?.sub ? await getUserById(req.user.sub) : null);
        if (!user) return sendError(res, 401, 'unauthenticated', 'Unauthorized');
        res.json({ user: publicUser(user) });
    } catch {
        internalError(res);
    }
});

const consentSchema = z.object({ version: z.string().max(32) }).strict();
const consentRateLimit = userRateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

/**
 * An account that has not accepted the current /terminos (one made with Google
 * from the login page, an older one, an invited one) accepts them here, once.
 * Only the version on screen can be accepted, so a stale page cannot record
 * consent to a wording it never showed.
 */
router.post('/consent', consentRateLimit, authenticate, requireFreshAccessToken, async (req: AuthRequest, res) => {
    try {
        const parsed = consentSchema.safeParse(req.body);
        if (!parsed.success) return sendError(res, 400, 'invalid_request', 'Invalid request');
        if (parsed.data.version !== HEALTH_DATA_CONSENT_VERSION) {
            return sendError(res, 409, 'terms_version_changed', 'These terms are no longer current');
        }
        const userId = req.userRecord?.id ?? req.user?.sub;
        if (!userId) return sendError(res, 401, 'unauthenticated', 'Unauthorized');
        await recordHealthDataConsent(userId, HEALTH_DATA_CONSENT_VERSION);
        const user = await getUserById(userId);
        if (!user) return sendError(res, 401, 'unauthenticated', 'Unauthorized');
        res.json({ user: publicUser(user) });
    } catch (error) {
        logError('[auth] consent failed', error);
        internalError(res);
    }
});

const deleteAccountSchema = z.object({ confirmEmail: z.string().max(255) }).strict();
const deleteAccountRateLimit = userRateLimit({ windowMs: 60 * 60 * 1000, max: 10 });

/**
 * Deletes the signed-in account and everything it loaded. The person types
 * their email to confirm, so a stray click or a forged request cannot do it.
 * See accountRepository.deleteAccount for what is and is not removed.
 */
router.delete('/account', deleteAccountRateLimit, authenticate, requireFreshAccessToken, async (req: AuthRequest, res) => {
    try {
        const parsed = deleteAccountSchema.safeParse(req.body);
        if (!parsed.success) return sendError(res, 400, 'invalid_request', 'Invalid request');
        const userId = req.userRecord?.id ?? req.user?.sub;
        const user = userId ? await getUserById(userId) : null;
        if (!user) return sendError(res, 401, 'unauthenticated', 'Unauthorized');
        if (parsed.data.confirmEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
            return sendError(res, 400, 'confirmation_mismatch', 'The confirmation does not match');
        }

        const result = await deleteAccount(user.id);
        if (result.outcome === 'last_admin') {
            return sendError(res, 409, 'last_admin', 'The last admin cannot delete their account');
        }
        if (result.outcome === 'foreign_rows') {
            console.error('[auth] account deletion refused: another account has diagnoses under its patients', { userId: user.id });
            return sendError(res, 409, 'account_inconsistent', 'The account cannot be deleted automatically');
        }
        if (result.outcome === 'not_found') {
            return sendError(res, 401, 'unauthenticated', 'Unauthorized');
        }

        console.warn('[auth] account deleted', { userId: user.id, patients: result.patients, diagnoses: result.diagnoses });
        res.clearCookie('access_token', accessCookieOptions);
        res.clearCookie('refresh_token', refreshCookieOptions);
        res.clearCookie(CSRF_COOKIE_NAME, csrfCookieOptions);
        res.json({ deleted: true });
    } catch (error) {
        logError('[auth] account deletion failed', error);
        internalError(res);
    }
});

router.post('/refresh', refreshRateLimit, async (req, res) => {
    try {
        const refreshToken = req.cookies?.['refresh_token'];
        if (!refreshToken) return sendError(res, 401, 'no_refresh_token', 'No refresh token');

        const decoded = verifyRefreshToken(refreshToken) as any;
        if (!decoded || typeof decoded.sub !== 'string' || typeof decoded.tokenVersion !== 'number') {
            return sendError(res, 403, 'session_expired', 'Invalid refresh token');
        }

        const user = await getUserById(decoded.sub);
        if (!user || user.token_version !== decoded.tokenVersion) {
            return sendError(res, 403, 'session_revoked', 'Token revoked');
        }

        const newAccessToken = signAccessToken(user);
        const newRefreshToken = signRefreshToken(user);
        res.cookie('access_token', newAccessToken, {
            ...accessCookieOptions,
            maxAge: ACCESS_TOKEN_MAX_AGE_MS
        });
        res.cookie('refresh_token', newRefreshToken, {
            ...refreshCookieOptions,
            maxAge: REFRESH_TOKEN_MAX_AGE_MS
        });
        setCsrfCookie(res);

        res.json({ user: publicUser(user) });
    } catch {
        internalError(res);
    }
});

router.post('/logout', logoutRateLimit, async (req, res) => {
    try {
        const refreshToken = req.cookies?.['refresh_token'];
        const accessTokenHeader = req.headers.authorization;
        const accessTokenCookie = req.cookies?.['access_token'];
        const accessToken =
            (accessTokenHeader && accessTokenHeader.split(' ')[1]) || accessTokenCookie || null;
        let userId: string | null = null;

        if (refreshToken) {
            const decoded = verifyRefreshToken(refreshToken) as any;
            if (decoded && typeof decoded.sub === 'string') {
                userId = decoded.sub;
            }
        }

        if (!userId && accessToken) {
            const decoded = verifyAccessToken(accessToken) as any;
            if (decoded && typeof decoded.sub === 'string') {
                userId = decoded.sub;
            }
        }

        if (userId) {
            await updateUserTokenVersion(userId);
        }
    } catch (error) {
        logError('[auth] logout token revocation failed', error);
    } finally {
        res.clearCookie('access_token', accessCookieOptions);
        res.clearCookie('refresh_token', refreshCookieOptions);
        res.clearCookie(CSRF_COOKIE_NAME, csrfCookieOptions);
        res.json({ message: 'Logged out' });
    }
});

export default router;
