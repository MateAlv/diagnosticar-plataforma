import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN } from '../config.js';
import { User } from '../repositories/userRepository.js';

export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

export function signAccessToken(user: User): string {
    const payload = {
        sub: user.id,
        role: user.role,
        tokenVersion: user.token_version,
    };
    return jwt.sign(payload, JWT_ACCESS_SECRET, {
        expiresIn: JWT_ACCESS_EXPIRES_IN,
        algorithm: 'HS256',
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
        return jwt.verify(token, JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    } catch (e) {
        return null;
    }
}

export function verifyRefreshToken(token: string) {
    try {
        return jwt.verify(token, JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
    } catch (e) {
        return null;
    }
}
