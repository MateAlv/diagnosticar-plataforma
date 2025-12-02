import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { PORT } from './config.js';
import { migrate } from './database/pool.js';
import authRouter from './routes/auth.js';

const app = express();

app.use(helmet());
app.use(cors({
    origin: ['http://localhost:3000'], // Allow frontend
    credentials: true
}));
app.use(cookieParser());
app.use(express.json());

app.use('/api/auth', authRouter);

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

async function start() {
    await migrate();
    app.listen(PORT, () => {
        console.log(`Backend running on port ${PORT}`);
    });
}

start().catch(console.error);
