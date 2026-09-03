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
import { CSRF_COOKIE_NAME } from '../middleware/csrfMiddleware.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { hashToken } from '../utils/tokens.js';
import { stripNullBytes } from '../utils/sanitize.js';
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

const signupRateLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
const loginRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const googleRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

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
    return passport.authenticate('google', {
        scope: ['profile', 'email'],
        session: false,
        prompt: 'select_account',
    })(req, res, next);
});

router.get(
    '/oauth/google/callback',
    (req, res, next) => {
        if (!GOOGLE_AUTH_ENABLED) {
            return googleAuthUnavailable(res);
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
                console.error('[auth] google callback failed', error);
            }
            return res.redirect(`${GOOGLE_REDIRECT_URL}?error=google_auth_failed`);
        }
    }
);

router.post('/signup', signupRateLimit, async (req, res) => {
    try {
        const parsed = signupSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid payload' });
        }
        const { email, password, fullName, name, organization } = stripNullBytes(parsed.data);
        const safeFullName = fullName ?? name ?? undefined;
        const safeOrganization = organization ?? undefined;

        const existing = await getUserByEmail(email);
        if (existing) {
            if (!existing.verified && existing.auth_provider === 'local') {
                // Stuck unverified account — auto-verify and log in
                await verifyUser(existing.id);
                const accessToken = signAccessToken(existing);
                const refreshToken = signRefreshToken(existing);
                res.cookie('access_token', accessToken, { ...accessCookieOptions, maxAge: ACCESS_TOKEN_MAX_AGE_MS });
                res.cookie('refresh_token', refreshToken, { ...refreshCookieOptions, maxAge: REFRESH_TOKEN_MAX_AGE_MS });
                setCsrfCookie(res);
                return res.json({ user: { id: existing.id, email: existing.email, full_name: existing.full_name, role: existing.role } });
            }
            // Existing verified account — silent response
            return res.json({ message: 'If an account exists, a verification email will be sent.' });
        }

        const passwordHash = await hashPassword(password);
        const verificationTokenHash = hashToken(crypto.randomBytes(32).toString('hex'));
        const newUser = await createUser(email, passwordHash, verificationTokenHash, safeFullName, safeOrganization);

        // Auto-verify immediately — email verification is handled separately
        await verifyUser(newUser.id);

        const accessToken = signAccessToken(newUser);
        const refreshToken = signRefreshToken(newUser);
        res.cookie('access_token', accessToken, { ...accessCookieOptions, maxAge: ACCESS_TOKEN_MAX_AGE_MS });
        res.cookie('refresh_token', refreshToken, { ...refreshCookieOptions, maxAge: REFRESH_TOKEN_MAX_AGE_MS });
        setCsrfCookie(res);

        res.json({ user: { id: newUser.id, email: newUser.email, full_name: newUser.full_name, role: newUser.role } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/login', loginRateLimit, async (req, res) => {
    try {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid payload' });
        }
        const { email, password } = parsed.data;
        const user = await getUserByEmail(email);

        if (!user || !(await verifyPassword(password, user.password_hash)) || !user.verified) {
            return res.status(401).json({ error: 'Invalid credentials' });
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

        res.json({ user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/verify', async (req, res) => {
    try {
        const parsed = verifySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid payload' });
        }
        const { token } = parsed.data;
        const user = await getUserByVerificationToken(token);

        if (!user) {
            return res.status(400).json({ error: 'Invalid token' });
        }

        await verifyUser(user.id);
        res.json({ message: 'Verified' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error' });
    }
});

router.get('/me', authenticate, requireFreshAccessToken, async (req: AuthRequest, res) => {
    try {
        const user = req.userRecord ?? (req.user?.sub ? await getUserById(req.user.sub) : null);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role } });
    } catch {
        res.status(500).json({ error: 'Error' });
    }
});

router.post('/refresh', async (req, res) => {
    try {
        const refreshToken = req.cookies?.['refresh_token'];
        if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });

        const decoded = verifyRefreshToken(refreshToken) as any;
        if (!decoded || typeof decoded.sub !== 'string' || typeof decoded.tokenVersion !== 'number') {
            return res.status(403).json({ error: 'Invalid refresh token' });
        }

        const user = await getUserById(decoded.sub);
        if (!user || user.token_version !== decoded.tokenVersion) {
            return res.status(403).json({ error: 'Token revoked' });
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

        res.json({ user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role } });
    } catch {
        res.status(500).json({ error: 'Error' });
    }
});

router.post('/logout', async (req, res) => {
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
        if (!IS_PRODUCTION) {
            console.error('[auth] logout token revocation failed', error);
        }
    } finally {
        res.clearCookie('access_token', accessCookieOptions);
        res.clearCookie('refresh_token', refreshCookieOptions);
        res.clearCookie(CSRF_COOKIE_NAME, csrfCookieOptions);
        res.json({ message: 'Logged out' });
    }
});

export default router;
