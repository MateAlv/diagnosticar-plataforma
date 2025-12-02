import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/authService.js';

export interface AuthRequest extends Request {
    user?: any;
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
