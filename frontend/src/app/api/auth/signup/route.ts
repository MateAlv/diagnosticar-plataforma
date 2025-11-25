import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { hashPassword, createUser, getUserByEmail } from '@/lib/auth';
import { query } from '@/lib/db';
import { sendVerificationEmail } from '@/lib/email';

export async function POST(request: Request) {
    try {
        const { email, password, fullName, organization } = await request.json();

        if (!email || !password) {
            return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
        }

        const existingUser = await getUserByEmail(email);
        if (existingUser) {
            return NextResponse.json({ error: 'User already exists' }, { status: 400 });
        }

        const passwordHash = await hashPassword(password);
        const user = await createUser(email, passwordHash, fullName, organization);

        const verificationToken = crypto.randomBytes(32).toString('hex');
        await query('UPDATE users SET verification_token = $1 WHERE id = $2', [verificationToken, user.id]);

        await sendVerificationEmail(email, verificationToken);

        return NextResponse.json({ message: 'User created. Please check your email to verify your account.' });
    } catch (error) {
        console.error('Signup error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
