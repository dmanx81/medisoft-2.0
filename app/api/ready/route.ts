import { database } from '@/lib/db';
import { logError } from '@/lib/log';
import { securityHeaderInit } from '@/lib/http/security-headers';

export const runtime = 'nodejs';

export async function GET() {
  const headers = securityHeaderInit('/api/ready');
  try {
    await database().query('SELECT 1');
    return Response.json({ status: 'ready' }, { headers });
  } catch {
    logError('Readiness check failed');
    return Response.json({ status: 'not_ready' }, { status: 503, headers });
  }
}

export async function HEAD() {
  const headers = securityHeaderInit('/api/ready');
  try {
    await database().query('SELECT 1');
    return new Response(null, { status: 200, headers });
  } catch {
    logError('Readiness check failed');
    return new Response(null, { status: 503, headers });
  }
}
