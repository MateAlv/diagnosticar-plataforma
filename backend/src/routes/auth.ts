import { Router } from 'express';
import crypto from 'crypto';
import { createUser, getUserByEmail, getUserById, verifyUser, updateUserTokenVersion, getUserByVerificationToken } from '../repositories/userRepository.js';
import { hashPassword, verifyPassword, signAccessToken, signRefreshToken, verifyRefreshToken } from '../services/authService.js';
import { sendVerificationEmail } from '../services/emailService.js';
import { authenticate, AuthRequest } from '../middleware/authMiddleware.js';

const router = Router();

router.post('/signup', async (req, res) => {
    try {
        const { email, password, fullName, organization } = req.body;

        const existing = await getUserByEmail(email);
        if (existing) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const passwordHash = await hashPassword(password);
        const verificationToken = crypto.randomBytes(32).toString('hex');

        await createUser(email, passwordHash, verificationToken, fullName, organization);
        await sendVerificationEmail(email, verificationToken);

        res.status(201).json({ message: 'User created. Please check your email to verify.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await getUserByEmail(email);

        if (!user || !(await verifyPassword(password, user.password_hash))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!user.verified) {
            return res.status(403).json({ error: 'Email not verified' });
        }

        const accessToken = signAccessToken(user);
        const refreshToken = signRefreshToken(user);

        // Set cookies
        res.cookie('access_token', accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 15 * 60 * 1000 // 15m
        });

        res.cookie('refresh_token', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7d
        });

        res.json({ user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/verify', async (req, res) => {
    try {
        const { token } = req.body;
        const user = await getUserByVerificationToken(token);

        if (!user) {
            return res.status(400).json({ error: 'Invalid token' });
        }

        await verifyUser(user.id);
        res.json({ message: 'Verified' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error' });
    }
});

router.get('/me', authenticate, async (req: AuthRequest, res) => {
    try {
        const user = await getUserById(req.user.sub);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role } });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

router.post('/refresh', async (req, res) => {
    try {
        const refreshToken = req.cookies?.['refresh_token'];
        if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });

        const decoded = verifyRefreshToken(refreshToken) as any;
        if (!decoded) return res.status(403).json({ error: 'Invalid refresh token' });

        const user = await getUserById(decoded.sub);
        if (!user || user.token_version !== decoded.tokenVersion) {
            return res.status(403).json({ error: 'Token revoked' });
        }

        const newAccessToken = signAccessToken(user);
        res.cookie('access_token', newAccessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 15 * 60 * 1000
        });

        res.json({ message: 'Refreshed' });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    res.json({ message: 'Logged out' });
});

export default router;
