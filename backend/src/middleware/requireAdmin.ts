import { Response, NextFunction } from 'express';
import { type AuthRequest } from './authMiddleware.js';
import { sendError } from '../utils/httpErrors.js';

/**
 * Gate for the backoffice.
 *
 * Must run after `authenticate` and `requireFreshAccessToken`: the role is read
 * from the database row those put on the request, never from the JWT. A token
 * issued before a demotion still carries `role: "admin"` in its payload, so
 * trusting the claim would keep a removed admin working until their token
 * expired.
 *
 * Responds 404, not 403. A 403 confirms /api/admin exists and that the caller
 * is simply not an admin, which is a free hint for anyone probing; the
 * backoffice is invisible to non-admins instead.
 */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
    const user = req.userRecord;

    if (!user) {
        return sendError(res, 404, 'not_found', 'Not found');
    }

    if (user.status !== 'active' || user.role !== 'admin') {
        console.warn('[admin] denied', { userId: user.id, path: req.path });
        return sendError(res, 404, 'not_found', 'Not found');
    }

    return next();
}
