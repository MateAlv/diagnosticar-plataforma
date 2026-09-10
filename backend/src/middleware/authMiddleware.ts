import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/authService.js';
import { getUserById, type User } from '../repositories/userRepository.js';

export interface AuthRequest extends Request {
    user?: any;
    userRecord?: User;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    const cookieToken = req.cookies?.['access_token'];
    const finalToken = token || cookieToken;

    if (!finalToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const decoded = verifyAccessToken(finalToken);
    if (!decoded) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    req.user = decoded;
    next();
}

export async function requireFreshAccessToken(req: AuthRequest, res: Response, next: NextFunction) {
    try {
        const payload = req.user;
        if (!payload || typeof payload.sub !== 'string' || typeof payload.tokenVersion !== 'number') {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const user = await getUserById(payload.sub);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (user.token_version !== payload.tokenVersion) {
            return res.status(403).json({ error: 'Token revoked' });
        }

        req.userRecord = user;
        return next();
    } catch {
        return res.status(500).json({ error: 'Error' });
    }
}
