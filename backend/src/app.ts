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
import { internalError, sendError } from './utils/httpErrors.js';

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
    //
    // `release` is the tag the deploy ran, so production can ask staging what
    // it runs (ops/deploy.sh production). Absent outside a tagged deploy.
    app.get(['/health', '/api/health'], async (req, res) => {
        try {
            const { query } = await import('./database/pool.js');
            await query('SELECT 1');
            res.json({ status: 'ok', release: process.env.RELEASE_TAG || undefined });
        } catch {
            res.status(503).json({ status: 'error', detail: 'database unreachable' });
        }
    });

    // Express's default 404 is an HTML page; the browser expects JSON from
    // anything under /api.
    app.use('/api', (req, res) => {
        sendError(res, 404, 'not_found', 'Not found');
    });

    // Terminal error handler. Without this Express prints the stack trace into
    // the response body in non-production, which would leak internals — and this
    // app holds clinical data, so bodies stay opaque in every environment.
    app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (res.headersSent) {
            return next(err);
        }
        if (err?.message === 'Not allowed by CORS') {
            return sendError(res, 403, 'invalid_origin', 'Invalid origin');
        }
        const { type, status, expose } = err as { type?: string; status?: number; expose?: boolean };
        if (type === 'entity.too.large') {
            return sendError(res, 413, 'payload_too_large', 'Payload too large');
        }
        if (err instanceof SyntaxError && 'body' in err) {
            return sendError(res, 400, 'invalid_json', 'Invalid JSON');
        }
        // body-parser's other client errors (unsupported charset, aborted
        // request) carry their own 4xx; answering 500 would blame the server.
        if (expose && typeof status === 'number' && status >= 400 && status < 500) {
            return sendError(res, status, 'bad_request', 'Bad request');
        }
        console.error('[unhandled]', err?.message);
        return internalError(res);
    });

    return app;
}
