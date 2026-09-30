import { Request, Response, NextFunction } from 'express';
import { FRONTEND_URL, IS_PRODUCTION } from '../config.js';
import { sendError } from '../utils/httpErrors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';
const allowedOrigins = new Set<string>();

try {
    allowedOrigins.add(new URL(FRONTEND_URL).origin);
} catch {
    if (IS_PRODUCTION) {
        throw new Error('[config] FRONTEND_URL must be a valid URL.');
    }
}

function extractOrigin(value?: string | null): string | null {
    if (!value) return null;
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

export function enforceOrigin(req: Request, res: Response, next: NextFunction) {
    if (SAFE_METHODS.has(req.method)) {
        return next();
    }

    const origin = extractOrigin(req.headers.origin);
    const referer = extractOrigin(req.headers.referer);
    const candidate = origin ?? referer;

    if (!candidate) {
        return next();
    }

    if (!allowedOrigins.has(candidate)) {
        return sendError(res, 403, 'invalid_origin', 'Invalid origin');
    }

    return next();
}

function hasAuthCookies(req: Request): boolean {
    const cookies = req.cookies ?? {};
    return Boolean(cookies.access_token || cookies.refresh_token);
}

export function enforceCsrf(req: Request, res: Response, next: NextFunction) {
    if (SAFE_METHODS.has(req.method)) {
        return next();
    }

    if (!hasAuthCookies(req)) {
        return next();
    }

    // Logging out must work even when the csrf cookie is gone while the
    // session cookies remain, or the person can never sign out. Forcing
    // someone's logout is the most a forged request can do here, and
    // enforceOrigin still rejects a foreign Origin.
    if (req.path === '/api/auth/logout') {
        return next();
    }

    const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
    const headerToken = req.get(CSRF_HEADER_NAME);

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return sendError(res, 403, 'csrf_mismatch', 'CSRF token mismatch');
    }

    return next();
}
