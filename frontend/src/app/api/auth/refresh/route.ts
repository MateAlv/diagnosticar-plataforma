import { NextResponse } from 'next/server';
import { signAccessToken, verifyAccessToken, getUserById, JWT_REFRESH_SECRET } from '@/lib/auth';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get('refreshToken')?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
  }

  try {
    const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as any;
    const user = await getUserById(payload.sub);

    if (!user || user.token_version !== payload.tokenVersion) {
      return NextResponse.json({ error: 'Invalid refresh token' }, { status: 401 });
    }

    const newAccessToken = signAccessToken(user);

    const response = NextResponse.json({ user: { id: user.id, email: user.email, name: user.full_name, role: user.role } });

    response.cookies.set('accessToken', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60, // 15 minutes
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Refresh error:', error);
    return NextResponse.json({ error: 'Invalid refresh token' }, { status: 401 });
  }
}
