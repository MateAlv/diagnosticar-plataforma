import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { PORT, FRONTEND_URL } from './config.js';
import { migrate } from './database/pool.js';
import authRouter from './routes/auth.js';
import { enforceCsrf, enforceOrigin } from './middleware/csrfMiddleware.js';
import passport from 'passport';
import { configureGoogleAuth } from './services/googleAuth.js';

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
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(enforceOrigin);
app.use(enforceCsrf);
app.use(passport.initialize());

app.use('/api/auth', authRouter);

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

async function start() {
    configureGoogleAuth();
    await migrate();
    app.listen(PORT, () => {
        console.log(`Backend running on port ${PORT}`);
    });
}

start().catch(console.error);
