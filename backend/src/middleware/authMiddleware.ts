import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/authService.js';
import { getUserById, type User } from '../repositories/userRepository.js';
import { internalError, sendError } from '../utils/httpErrors.js';

export interface AuthRequest extends Request {
    user?: any;
    userRecord?: User;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
    // Only the Bearer scheme. Splitting on a space accepted any scheme's
    // credential, so behind a proxy doing HTTP basic auth — staging sits behind
    // Traefik's — the browser's `Authorization: Basic <base64>` was parsed as a
    // token, failed verification, and returned 403 "Forbidden" where an
    // anonymous caller should get 401. The header is the proxy's, not the
    // caller's, and carries no claim about who this user is.
    const authHeader = req.headers.authorization;
    const bearer = /^Bearer\s+(.+)$/i.exec(authHeader ?? '');
    const token = bearer?.[1];
    const cookieToken = req.cookies?.['access_token'];
    const finalToken = token || cookieToken;

    if (!finalToken) {
        return sendError(res, 401, 'unauthenticated', 'Unauthorized');
    }

    const decoded = verifyAccessToken(finalToken);
    if (!decoded) {
        return sendError(res, 403, 'session_expired', 'Forbidden');
    }

    req.user = decoded;
    next();
}

export async function requireFreshAccessToken(req: AuthRequest, res: Response, next: NextFunction) {
    try {
        const payload = req.user;
        if (!payload || typeof payload.sub !== 'string' || typeof payload.tokenVersion !== 'number') {
            return sendError(res, 401, 'unauthenticated', 'Unauthorized');
        }

        const user = await getUserById(payload.sub);
        if (!user) {
            return sendError(res, 401, 'unauthenticated', 'Unauthorized');
        }

        if (user.token_version !== payload.tokenVersion) {
            return sendError(res, 403, 'session_revoked', 'Token revoked');
        }

        req.userRecord = user;
        return next();
    } catch {
        return internalError(res);
    }
}

/**
 * Refuses every request from an account that still holds an admin-issued
 * temporary password.
 *
 * Mounted on the protected routers rather than left to the frontend: hiding the
 * UI stops nobody who can use curl, and the whole point of the flag is that
 * someone other than the account holder knows this password.
 *
 * `/api/auth/change-password` is deliberately not behind this — it is the exit.
 */
export function blockUntilPasswordChanged(req: AuthRequest, res: Response, next: NextFunction) {
    if (req.userRecord?.must_change_password) {
        return res.status(403).json({
            error: 'Password change required',
            code: 'PASSWORD_CHANGE_REQUIRED',
        });
    }
    return next();
}

