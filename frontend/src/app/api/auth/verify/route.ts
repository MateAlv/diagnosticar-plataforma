import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
        return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    try {
        const res = await query('SELECT * FROM users WHERE verification_token = $1', [token]);
        if (res.rows.length === 0) {
            return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
        }

        const user = res.rows[0];
        await query('UPDATE users SET verified = TRUE, verification_token = NULL WHERE id = $1', [user.id]);

        return NextResponse.redirect(new URL('/login?verified=true', request.url));
    } catch (error) {
        console.error('Verification error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
