// Every backend test imports this FIRST. config.ts reads process.env at import
// time, so the values have to exist before any src module is pulled in.
// dotenv does not overwrite variables that are already set, so a developer's
// local backend/.env cannot bleed into a test run.

export const TEST_ORIGIN = 'https://diagnosticar.test.local';

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.FRONTEND_URL = TEST_ORIGIN;
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'b'.repeat(48);
process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:5432/diagnosticar_test';

// Google OAuth stays off unless a test opts in, so the passport strategy is
// never registered against real credentials.
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
