import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import passport from 'passport';
import { FRONTEND_URL } from './config.js';
import authRouter from './routes/auth.js';
import patientsRouter from './routes/patients.js';
import adminRouter from './routes/admin.js';
import genesRouter from './routes/genes.js';
import hpoRouter from './routes/hpo.js';
import questionsRouter from './routes/questions.js';
import { enforceCsrf, enforceOrigin } from './middleware/csrfMiddleware.js';
import { globalRateLimit } from './middleware/rateLimit.js';

/**
 * Builds the Express app without binding a port or touching the network.
 * `index.ts` owns the lifecycle (migrate + listen); tests import this directly
 * so they can drive the real middleware stack over an ephemeral port.
 */
export function createApp() {
    const app = express();

    app.disable('x-powered-by');
    app.set('trust proxy', 1);

    const allowedOrigins = new Set([new URL(FRONTEND_URL).origin]);

    app.use(helmet());
    app.use(cors({
        origin: (origin, callback) => {
            if (!origin) {
                return callback(null, true);
            }
            if (allowedOrigins.has(origin)) {
                return callback(null, true);
            }
            return callback(new Error('Not allowed by CORS'));
        },
        credentials: true
    }));
    // Coarse ceiling ahead of routing, so a route added later without its own
    // limiter is never completely unprotected. The per-route limits are the
    // real policy; this should never fire for a person using the site.
    app.use(globalRateLimit);
    app.use(cookieParser());
    app.use(express.json({ limit: '1mb' }));
    app.use(enforceOrigin);
    app.use(enforceCsrf);
    app.use(passport.initialize());

    app.use('/api/auth', authRouter);
    app.use('/api/patients', patientsRouter);
    app.use('/api/admin', adminRouter);
    app.use('/api/genes', genesRouter);
    app.use('/api/hpo', hpoRouter);
    app.use('/api/questions', questionsRouter);

    // Also mounted under /api because Traefik routes the backend on
    // PathPrefix(`/api`); a bare /health never reaches the container through
    // the proxy, which made the deploy smoke test unable to see a healthy
    // backend.
    app.get(['/health', '/api/health'], async (req, res) => {
        try {
            const { query } = await import('./database/pool.js');
            await query('SELECT 1');
            res.json({ status: 'ok' });
        } catch {
            res.status(503).json({ status: 'error', detail: 'database unreachable' });
        }
    });

    // Terminal error handler. Without this Express prints the stack trace into
    // the response body in non-production, which would leak internals — and this
    // app holds clinical data, so bodies stay opaque in every environment.
    app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (res.headersSent) {
            return next(err);
        }
        if (err?.message === 'Not allowed by CORS') {
            return res.status(403).json({ error: 'Invalid origin' });
        }
        if ((err as { type?: string }).type === 'entity.too.large') {
            return res.status(413).json({ error: 'Payload too large' });
        }
        if (err instanceof SyntaxError && 'body' in err) {
            return res.status(400).json({ error: 'Invalid JSON' });
        }
        console.error('[unhandled]', err?.message);
        return res.status(500).json({ error: 'Internal server error' });
    });

    return app;
}
