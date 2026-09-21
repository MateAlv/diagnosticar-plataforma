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

// Access tokens are signed with RS256 when a keypair is configured, so the
// HPO gateway on brainy can verify them with the public half alone. It must
// never hold anything that can mint a token: JWT_ACCESS_SECRET is symmetric,
// so copying that there would let the GPU node issue tokens for any user,
// including an admin.
//
// Refresh tokens stay HS256 deliberately. Only this service ever sees one, so
// there is nothing to gain from a keypair.
function readMultilineEnv(name: string): string | undefined {
    const raw = process.env[name];
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return undefined;
    }
    // PEM keys carry newlines, which .env files generally cannot, so `\n`
    // escapes are accepted and unescaped here.
    return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

export const JWT_ACCESS_PRIVATE_KEY = readMultilineEnv('JWT_ACCESS_PRIVATE_KEY');
export const JWT_ACCESS_PUBLIC_KEY = readMultilineEnv('JWT_ACCESS_PUBLIC_KEY');

// One key without the other signs tokens nothing can verify, or verifies
// tokens nothing signs. Fail at boot rather than at the first login.
if (Boolean(JWT_ACCESS_PRIVATE_KEY) !== Boolean(JWT_ACCESS_PUBLIC_KEY)) {
    throw new Error(
        '[config] JWT_ACCESS_PRIVATE_KEY and JWT_ACCESS_PUBLIC_KEY must be set together.',
    );
}

export const JWT_ACCESS_ALGORITHM: 'RS256' | 'HS256' = JWT_ACCESS_PRIVATE_KEY
    ? 'RS256'
    : 'HS256';

// Existing sessions hold HS256 tokens, which stop verifying the moment
// signing moves to RS256. Accepting both for one access-token lifetime (15m)
// avoids signing everyone out mid-session; it is off by default because an
// HS256 token is exactly what an attacker holding the old secret could forge.
export const JWT_ACCEPT_LEGACY_HS256 =
    process.env.JWT_ACCEPT_LEGACY_HS256 === 'true';

if (IS_PRODUCTION && JWT_ACCESS_ALGORITHM === 'HS256') {
    console.warn(
        '[config] access tokens are HS256; the HPO gateway cannot verify them ' +
            'without the signing secret. Set JWT_ACCESS_PRIVATE_KEY/PUBLIC_KEY.',
    );
}
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

// Baked in at image build time by .github/workflows/release.yml. The running
// container is the only thing that knows which release it actually is — the
// deploy tag on nodo0 is a file, and a hand-started container would not match
// it. Unset outside a released image, which is itself informative.
export const RELEASE_VERSION = process.env.RELEASE_VERSION || 'dev';
export const RELEASE_COMMIT = process.env.RELEASE_COMMIT || 'unknown';
export const RELEASE_BUILT_AT = process.env.RELEASE_BUILT_AT || 'unknown';
