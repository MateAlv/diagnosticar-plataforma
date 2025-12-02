import dotenv from 'dotenv';

dotenv.config();

export const PORT = parseInt(process.env.PORT || '4000', 10);
export const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/diagnostic_ar';
export const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev_secret_access';
export const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev_secret_refresh';
export const JWT_ACCESS_EXPIRES_IN = '15m';
export const JWT_REFRESH_EXPIRES_IN = '7d';
export const SMTP_HOST = process.env.SMTP_HOST;
export const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
export const SMTP_USER = process.env.SMTP_USER;
export const SMTP_PASS = process.env.SMTP_PASS;
export const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
