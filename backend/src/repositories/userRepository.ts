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
    must_change_password?: boolean;
    health_data_consent_at?: string | null;
    health_data_consent_version?: string | null;
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

export async function recordHealthDataConsent(id: string, version: string): Promise<void> {
    await query(
        'UPDATE users SET health_data_consent_at = now(), health_data_consent_version = $2 WHERE id = $1',
        [id, version],
    );
}

export async function verifyUser(id: string) {
    await query('UPDATE users SET verified = TRUE, verification_token = NULL WHERE id = $1', [id]);
}

export async function updateUserTokenVersion(id: string) {
    await query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [id]);
}

export async function deleteUserById(id: string) {
    await query('DELETE FROM users WHERE id = $1', [id]);
}

export async function updateVerificationToken(id: string, tokenHash: string) {
    await query('UPDATE users SET verification_token = $1 WHERE id = $2', [tokenHash, id]);
}

/**
 * Creates an account on someone else's behalf, from the backoffice.
 *
 * `verified` is true because an admin vouching for the address is the
 * verification — there is no email to click, and `sendVerificationEmail`
 * currently has no callers anyway. `must_change_password` is the important
 * part: the inviter chose this password and therefore knows it, so the account
 * is unusable for anything else until the invitee replaces it.
 */
export async function createInvitedUser(
    email: string,
    passwordHash: string,
    role: string,
    fullName: string | null,
    organization: string | null,
) {
    const res = await query(
        `INSERT INTO users (email, password_hash, full_name, organization, role, verified, must_change_password)
     VALUES ($1, $2, $3, $4, $5, TRUE, TRUE)
     RETURNING *`,
        [email, passwordHash, fullName, organization, role],
    );
    return res.rows[0];
}

/**
 * Replaces the password and clears the forced-change flag.
 *
 * Bumps `token_version` in the same statement, which invalidates every existing
 * session for this user. If the temporary password leaked — and it travelled
 * out of band, so assume it might have — any session an attacker opened with it
 * dies here.
 */
export async function setPassword(id: string, passwordHash: string) {
    await query(
        `UPDATE users
        SET password_hash = $1,
            must_change_password = FALSE,
            token_version = token_version + 1,
            updated_at = now()
      WHERE id = $2`,
        [passwordHash, id],
    );
}

export async function listStaff(): Promise<User[]> {
    const res = await query(
        `SELECT id, email, full_name, organization, role, status, verified,
            must_change_password, created_at, last_login_at
       FROM users
      WHERE role = 'admin'
      ORDER BY created_at ASC`,
    );
    return res.rows;
}

export async function setUserRole(id: string, role: string) {
    // Bumping token_version makes the change take effect immediately rather
    // than whenever the target's current access token happens to expire.
    await query(
        `UPDATE users SET role = $1, token_version = token_version + 1, updated_at = now() WHERE id = $2`,
        [role, id],
    );
}
