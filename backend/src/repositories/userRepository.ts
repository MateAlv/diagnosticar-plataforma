import { query } from '../database/pool.js';

export type User = {
    id: string;
    email: string;
    full_name: string | null;
    organization: string | null;
    role: string;
    status: string;
    token_version: number;
    verified: boolean;
    password_hash: string;
    verification_token?: string | null;
};

export async function getUserByEmail(email: string): Promise<User | null> {
    const res = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (res.rows.length === 0) return null;
    return res.rows[0];
}

export async function getUserById(id: string): Promise<User | null> {
    const res = await query('SELECT * FROM users WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return res.rows[0];
}

export async function getUserByVerificationToken(token: string): Promise<User | null> {
    const res = await query('SELECT * FROM users WHERE verification_token = $1', [token]);
    if (res.rows.length === 0) return null;
    return res.rows[0];
}

export async function createUser(email: string, passwordHash: string, verificationToken: string, fullName?: string, organization?: string) {
    const res = await query(
        `INSERT INTO users (email, password_hash, verification_token, full_name, organization)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
        [email, passwordHash, verificationToken, fullName, organization]
    );
    return res.rows[0];
}

export async function verifyUser(id: string) {
    await query('UPDATE users SET verified = TRUE, verification_token = NULL WHERE id = $1', [id]);
}

export async function updateUserTokenVersion(id: string) {
    await query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [id]);
}
