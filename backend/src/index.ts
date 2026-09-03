import { PORT } from './config.js';
import { migrate } from './database/pool.js';
import { configureGoogleAuth } from './services/googleAuth.js';
import { createApp } from './app.js';

const app = createApp();

async function start() {
    configureGoogleAuth();
    await migrate();
    app.listen(PORT, () => {
        console.log(`Backend running on port ${PORT}`);
    });
}

start().catch((error) => {
    console.error('[startup] failed to start backend', error);
    process.exit(1);
});
