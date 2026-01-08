import { Request, Response, NextFunction } from 'express';
import { FRONTEND_URL, IS_PRODUCTION } from '../config.js';

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
        return res.status(403).json({ error: 'Invalid origin' });
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

    const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
    const headerToken = req.get(CSRF_HEADER_NAME);

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return res.status(403).json({ error: 'CSRF token mismatch' });
    }

    return next();
}
