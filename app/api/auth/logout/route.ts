import { NextResponse } from 'next/server';
import { currentUser, sessionCookie } from '@/lib/auth/session';
import { database } from '@/lib/db';
import { environment } from '@/lib/env';
import { validOrigin } from '@/lib/validation';
import { revokeSession } from '@/lib/auth/transactions';
export async function POST(request: Request) {
  try {
    const config = environment();
    if (!validOrigin(request.headers.get('origin'), config.APP_ORIGIN))
      return new Response('Forbidden', { status: 403 });
    const principal = await currentUser();
    if (principal) {
      const client = await database().connect();
      try {
        await revokeSession(client, principal);
      } finally {
        client.release();
      }
    }
    const response = NextResponse.redirect(
      new URL('/login', config.APP_ORIGIN),
      303,
    );
    response.cookies.set(sessionCookie, '', {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return response;
  } catch {
    return new Response('Sign-out could not complete. Please try again.', {
      status: 503,
    });
  }
}
