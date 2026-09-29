import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';

type RateLimitOptions = {
    windowMs: number;
    max: number;
    keyGenerator?: (req: Request) => string;
    message?: string;
    code?: string;
};

type Bucket = {
    count: number;
    resetAt: number;
};

const buckets = new Map<string, Bucket>();

function getKey(req: Request, keyGenerator?: (req: Request) => string): string {
    if (keyGenerator) return keyGenerator(req);
    return `${req.ip}:${req.path}`;
}

export function rateLimit(options: RateLimitOptions) {
    return (req: Request, res: Response, next: NextFunction) => {
        const key = getKey(req, options.keyGenerator);
        const now = Date.now();
        const bucket = buckets.get(key);

        if (!bucket || bucket.resetAt <= now) {
            // Evict stale entries periodically to prevent unbounded memory growth
            if (buckets.size > 10000) {
                for (const [k, v] of buckets) {
                    if (v.resetAt <= now) buckets.delete(k);
                }
            }
            buckets.set(key, { count: 1, resetAt: now + options.windowMs });
            return next();
        }

        if (bucket.count >= options.max) {
            const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
            res.setHeader('Retry-After', retryAfterSeconds.toString());
            const error = options.message ?? 'Too many requests';
            return res.status(429).json(options.code ? { error, code: options.code } : { error });
        }

        bucket.count += 1;
        return next();
    };
}

/**
 * Keys on the authenticated user when there is one, falling back to the IP.
 *
 * `req.ip` alone is the wrong key for anything behind authentication: one
 * account rotating through a proxy pool gets a fresh budget per address, while
 * a university or hospital NAT shares a single budget across everyone behind
 * it. Keying on the account fixes both directions.
 *
 * Must be used *after* `authenticate` to see a user; before it, this is just
 * the IP limiter.
 */
export function userOrIpKey(req: Request): string {
    const sub = (req as { user?: { sub?: string } }).user?.sub;
    if (sub) return `u:${sub}:${req.path}`;

    // Mounted before `authenticate` on most routes, so `req.user` is usually
    // still unset here. Fall back to the bearer token or access-token cookie,
    // which identifies the caller just as well for bucketing purposes. Hashed
    // so raw tokens never sit in the in-memory map, and unverified on purpose:
    // this is a bucket key, not an authorisation decision, so a forged token
    // only throttles itself.
    const raw =
        req.headers.authorization?.split(' ')[1] ??
        /(?:^|;\s*)access_token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    if (raw) {
        return `t:${createHash('sha256').update(raw).digest('hex').slice(0, 32)}:${req.path}`;
    }

    return `ip:${req.ip}:${req.path}`;
}

/** Convenience wrapper: the same limiter, keyed by identity. */
export function userRateLimit(options: Omit<RateLimitOptions, 'keyGenerator'>) {
    return rateLimit({ ...options, keyGenerator: userOrIpKey });
}

/**
 * A coarse ceiling applied to every request before routing.
 *
 * The per-route limits are the real policy; this exists so that an endpoint
 * added later without a limiter is not completely unprotected, and so a flood
 * costs an attacker more than it costs the node.
 *
 * Keyed per IP *and* per authenticated account, which matters more than it
 * looks: a hospital or university behind one NAT address is many people, and a
 * purely per-IP ceiling would let one busy user there lock out their
 * colleagues. Signed-in traffic is therefore counted against the account, and
 * only anonymous traffic shares the address bucket.
 *
 * It sits before cookieParser in the chain, so read the token straight off the
 * header rather than expecting `req.user`, which authenticate has not set yet.
 */
export const globalRateLimit = rateLimit({
    windowMs: 60_000,
    max: 600,
    keyGenerator: (req) => {
        const raw =
            req.headers.authorization?.split(' ')[1] ??
            // Hand-parsed: cookieParser has not run at this point in the chain.
            /(?:^|;\s*)access_token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
        if (raw) {
            // The token is not verified here — this is a bucket key, not an
            // authorisation decision, and hashing keeps the raw token out of
            // the in-memory map. A forged token only ever throttles itself.
            return `global:t:${createHash('sha256').update(raw).digest('hex').slice(0, 32)}`;
        }
        return `global:ip:${req.ip}`;
    },
});
