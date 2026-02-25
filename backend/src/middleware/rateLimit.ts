import { Request, Response, NextFunction } from 'express';

type RateLimitOptions = {
    windowMs: number;
    max: number;
    keyGenerator?: (req: Request) => string;
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
            return res.status(429).json({ error: 'Too many requests' });
        }

        bucket.count += 1;
        return next();
    };
}
