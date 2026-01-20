import dotenv from 'dotenv';

dotenv.config();

export const NODE_ENV = process.env.NODE_ENV ?? 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';

type EnvOptions = {
    fallback?: string;
    requiredInProd?: boolean;
    minLength?: number;
};

function readEnv(name: string, options: EnvOptions = {}): string {
    const { fallback, requiredInProd = false, minLength } = options;
    const rawValue = process.env[name];
    const hasValue = typeof rawValue === 'string' && rawValue.trim().length > 0;

    if (IS_PRODUCTION && requiredInProd && !hasValue) {
        throw new Error(`[config] ${name} must be set in production.`);
    }

    const value = hasValue ? rawValue : fallback;
    if (!value) {
        throw new Error(`[config] ${name} is missing.`);
    }

    if (!IS_PRODUCTION && !hasValue && fallback) {
        console.warn(`[config] ${name} is not set; using an insecure development default.`);
    }

    if (minLength && value.length < minLength) {
        const message = `[config] ${name} should be at least ${minLength} characters.`;
        if (IS_PRODUCTION) {
            throw new Error(message);
        }
        console.warn(message);
    }

    return value;
}

export const PORT = parseInt(process.env.PORT || '4000', 10);
export const DATABASE_URL = readEnv('DATABASE_URL', {
    requiredInProd: true,
});
export const JWT_ACCESS_SECRET = readEnv('JWT_ACCESS_SECRET', {
    requiredInProd: true,
    minLength: 32,
});
export const JWT_REFRESH_SECRET = readEnv('JWT_REFRESH_SECRET', {
    requiredInProd: true,
    minLength: 32,
});
export const JWT_ACCESS_EXPIRES_IN = '15m';
export const JWT_REFRESH_EXPIRES_IN = '7d';
export const SMTP_HOST = process.env.SMTP_HOST;
export const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
export const SMTP_USER = process.env.SMTP_USER;
export const SMTP_PASS = process.env.SMTP_PASS;
export const FRONTEND_URL = readEnv('FRONTEND_URL', {
    fallback: 'http://localhost:3000',
    requiredInProd: true,
});
export const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
export const GOOGLE_CALLBACK_URL =
    process.env.GOOGLE_CALLBACK_URL || `${BACKEND_URL}/api/auth/oauth/google/callback`;
export const GOOGLE_REDIRECT_URL = process.env.GOOGLE_REDIRECT_URL || `${FRONTEND_URL}/login`;
export const GOOGLE_AUTH_ENABLED = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
