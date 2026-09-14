import { NextResponse } from 'next/server';
import { currentUser, sessionCookie } from '@/lib/auth/session';
import { database } from '@/lib/db';
import { environment } from '@/lib/env';
import { validOrigin } from '@/lib/validation';
import { revokeSession } from '@/lib/auth/transactions';
import { sessionCookieOptions } from '@/lib/http/cookies';
import { logUnexpectedFailure } from '@/lib/log';
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
    response.cookies.set(
      sessionCookie,
      '',
      sessionCookieOptions(config.NODE_ENV === 'production', 0),
    );
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch {
    logUnexpectedFailure('auth-logout');
    return new Response('Sign-out could not complete. Please try again.', {
      status: 503,
    });
  }
}
