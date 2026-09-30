import type { Response } from 'express';

/**
 * Every error body is `{ error, code }`. The browser branches on `code` and
 * shows its own Spanish text, so `error` is for logs and curl, never for the
 * screen, and can be reworded without breaking anything.
 */
export function sendError(
    res: Response,
    status: number,
    code: string,
    error: string,
    extra?: Record<string, unknown>,
) {
    return res.status(status).json({ error, code, ...extra });
}

export const internalError = (res: Response) => sendError(res, 500, 'internal', 'Internal server error');
