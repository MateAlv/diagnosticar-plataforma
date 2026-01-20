import { query } from '../database/pool.js';
import { hashToken } from '../utils/tokens.js';

export type User = {
    id: string;
    email: string;
    full_name: string | null;
    organization: string | null;
    auth_provider: string | null;
    google_id: string | null;
    avatar_url: string | null;
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
    const hashedToken = hashToken(token);
    const res = await query('SELECT * FROM users WHERE verification_token = $1 OR verification_token = $2', [
        hashedToken,
        token,
    ]);
    if (res.rows.length === 0) return null;
    return res.rows[0];
}

export async function createUser(
    email: string,
    passwordHash: string,
    verificationToken: string | null,
    fullName?: string,
    organization?: string
) {
    const res = await query(
        `INSERT INTO users (email, password_hash, verification_token, full_name, organization)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
        [email, passwordHash, verificationToken, fullName, organization]
    );
    return res.rows[0];
}

export async function createGoogleUser(
    email: string,
    passwordHash: string,
    googleId: string,
    fullName?: string,
    avatarUrl?: string | null
) {
    const res = await query(
        `INSERT INTO users (email, password_hash, full_name, auth_provider, google_id, avatar_url, verified)
     VALUES ($1, $2, $3, 'google', $4, $5, TRUE)
     RETURNING *`,
        [email, passwordHash, fullName, googleId, avatarUrl]
    );
    return res.rows[0];
}

export async function getUserByGoogleId(googleId: string): Promise<User | null> {
    const res = await query('SELECT * FROM users WHERE google_id = $1', [googleId]);
    if (res.rows.length === 0) return null;
    return res.rows[0];
}

export async function linkGoogleAccount(
    id: string,
    googleId: string,
    avatarUrl?: string | null
): Promise<User | null> {
    const res = await query(
        'UPDATE users SET google_id = $1, avatar_url = COALESCE($2, avatar_url), verified = TRUE WHERE id = $3 RETURNING *',
        [googleId, avatarUrl ?? null, id]
    );
    if (res.rows.length === 0) return null;
    return res.rows[0];
}

export async function verifyUser(id: string) {
    await query('UPDATE users SET verified = TRUE, verification_token = NULL WHERE id = $1', [id]);
}

export async function updateUserTokenVersion(id: string) {
    await query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [id]);
}
