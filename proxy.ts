import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { applySecurityHeaders } from '@/lib/http/security-headers';
import { productionHttpsOrigin } from '@/lib/http/cookies';

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
  response.headers.set('x-request-id', requestId);
  applySecurityHeaders(request.nextUrl.pathname, response.headers, {
    productionHttps: productionHttpsOrigin(process.env.APP_ORIGIN),
  });
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)',
  ],
};
