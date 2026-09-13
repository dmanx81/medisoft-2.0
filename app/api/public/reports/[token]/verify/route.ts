import { NextResponse } from 'next/server';
import { database } from '@/lib/db';
import { environment } from '@/lib/env';
import {
  publicShareApi,
  readReportBody,
} from '@/features/reports/http';
import { shareCookie, verifyPublicShare } from '@/features/reports/shares';
export const runtime = 'nodejs';
type Context = { params: Promise<{ token: string }> };
export function DELETE() {
  return new Response(null, {
    status: 405,
    headers: {
      Allow: 'POST',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
export async function POST(request: Request, { params }: Context) {
  return publicShareApi(
    request,
    async () => {
      const { token } = await params;
      const body = await readReportBody(request);
      const client = await database().connect();
      try {
        const verified = await verifyPublicShare(client, token, body);
        const response = NextResponse.json(
          { ok: true, report: verified.view },
          {
            status: 200,
            headers: {
              'Cache-Control': 'private, no-store',
              'Referrer-Policy': 'no-referrer',
              'X-Content-Type-Options': 'nosniff',
              'X-Robots-Tag': 'noindex, nofollow',
            },
          },
        );
        response.cookies.set(shareCookie, verified.sessionToken, {
          httpOnly: true,
          secure: environment().NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: Math.max(
            60,
            Math.floor((verified.expiresAt.getTime() - Date.now()) / 1000),
          ),
        });
        return response;
      } finally {
        client.release();
      }
    },
    { checkOrigin: true },
  );
}
