import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import {
    JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET,
    JWT_ACCESS_EXPIRES_IN,
    JWT_REFRESH_EXPIRES_IN,
    JWT_ACCESS_ALGORITHM,
    JWT_ACCESS_PRIVATE_KEY,
    JWT_ACCESS_PUBLIC_KEY,
    JWT_ACCEPT_LEGACY_HS256,
} from '../config.js';
import { User } from '../repositories/userRepository.js';

export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

function accessSigningKey(): string {
    return JWT_ACCESS_ALGORITHM === 'RS256' ? JWT_ACCESS_PRIVATE_KEY! : JWT_ACCESS_SECRET;
}

function accessVerificationKey(): string {
    return JWT_ACCESS_ALGORITHM === 'RS256' ? JWT_ACCESS_PUBLIC_KEY! : JWT_ACCESS_SECRET;
}

export function signAccessToken(user: User): string {
    const payload = {
        sub: user.id,
        role: user.role,
        tokenVersion: user.token_version,
    };
    return jwt.sign(payload, accessSigningKey(), {
        expiresIn: JWT_ACCESS_EXPIRES_IN,
        algorithm: JWT_ACCESS_ALGORITHM,
    } as SignOptions);
}

export function signRefreshToken(user: User): string {
    const payload = {
        sub: user.id,
        tokenVersion: user.token_version,
    };
    return jwt.sign(payload, JWT_REFRESH_SECRET, {
        expiresIn: JWT_REFRESH_EXPIRES_IN,
        algorithm: 'HS256',
    } as SignOptions);
}

export function verifyAccessToken(token: string) {
    try {
        return jwt.verify(token, accessVerificationKey(), {
            // Pinned, never read from the token. A verifier that trusts the
            // token's own `alg` accepts "none", and under RS256 accepts a
            // token signed with the public key as if it were an HS256 shared
            // secret -- and the public key is, by design, public.
            algorithms: [JWT_ACCESS_ALGORITHM],
        });
    } catch {
        // During a cutover the previous algorithm is still in circulation.
        if (JWT_ACCESS_ALGORITHM === 'RS256' && JWT_ACCEPT_LEGACY_HS256) {
            try {
                return jwt.verify(token, JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
            } catch {
                return null;
            }
        }
        return null;
    }
}

export function verifyRefreshToken(token: string) {
    try {
        return jwt.verify(token, JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
    } catch {
        return null;
    }
}
