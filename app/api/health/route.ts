import { securityHeaderInit } from '@/lib/http/security-headers';

export const runtime = 'nodejs';

export function GET() {
  return Response.json(
    { status: 'ok' },
    { headers: securityHeaderInit('/api/health') },
  );
}

export function HEAD() {
  return new Response(null, {
    status: 200,
    headers: securityHeaderInit('/api/health'),
  });
}
