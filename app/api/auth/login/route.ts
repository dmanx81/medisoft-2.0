import { NextResponse } from 'next/server';
import { database } from '@/lib/db';
import { environment } from '@/lib/env';
import {
  loginSchema,
  requestOriginHeaders,
  validRequestOrigin,
} from '@/lib/validation';
import { authenticate } from '@/lib/auth/transactions';
import { sessionCookie } from '@/lib/auth/session';
import { sessionCookieOptions } from '@/lib/http/cookies';
import { logUnexpectedFailure } from '@/lib/log';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const config = environment();
    if (!validRequestOrigin(requestOriginHeaders(request), config.APP_ORIGIN))
      return new Response('Forbidden', { status: 403 });
    // Bound actual bytes, including chunked requests, before parsing credentials.
    const reader = request.body?.getReader();
    if (!reader) return new Response('Invalid request', { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) {
        await reader.cancel();
        return new Response('Request too large', { status: 413 });
      }
      chunks.push(value);
    }
    if (
      !request.headers
        .get('content-type')
        ?.startsWith('application/x-www-form-urlencoded')
    )
      return new Response('Unsupported form', { status: 415 });
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    const credentials = loginSchema.safeParse({
      email: form.get('email'),
      password: form.get('password'),
    });
    const failed = () =>
      NextResponse.redirect(
        new URL('/login?error=credentials', config.APP_ORIGIN),
        303,
      );
    if (!credentials.success) return failed();
    const client = await database().connect();
    const session = await authenticate(
      client,
      credentials.data.email,
      credentials.data.password,
    ).finally(() => client.release());
    if (!session) return failed();
    const response = NextResponse.redirect(
      new URL('/app', config.APP_ORIGIN),
      303,
    );
    response.cookies.set(
      sessionCookie,
      session.token,
      sessionCookieOptions(config.NODE_ENV === 'production', 8 * 60 * 60),
    );
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch {
    logUnexpectedFailure('auth-login');
    return new Response(
      'Sign-in is temporarily unavailable. Please try again later.',
      { status: 503 },
    );
  }
}
