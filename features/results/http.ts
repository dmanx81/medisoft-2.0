import 'server-only';
import { currentUser } from '@/lib/auth/session';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import { requestOriginHeaders, validRequestOrigin } from '@/lib/validation';
import { environment } from '@/lib/env';
import { OrderError } from '@/features/orders/types';
import { ResultError } from './types';
import { ReportError } from '@/features/reports/types';
import { logUnexpectedFailure } from '@/lib/log';
export async function resultApi(
  request: Request,
  permission: Permission,
  handler: (principal: Principal) => Promise<unknown>,
) {
  try {
    const principal = await currentUser();
    if (!principal)
      throw new ResultError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    if (!can(principal.role, permission))
      throw new ResultError(
        403,
        'FORBIDDEN',
        'Your role does not allow this action.',
      );
    if (
      request.method !== 'GET' &&
      !validRequestOrigin(requestOriginHeaders(request), environment().APP_ORIGIN)
    )
      throw new ResultError(
        403,
        'FORBIDDEN',
        'Request origin was not accepted.',
      );
    return reply(await handler(principal));
  } catch (error) {
    if (
      error instanceof ResultError ||
      error instanceof OrderError ||
      error instanceof ReportError
    )
      return reply(
        {
          code: error.code,
          message: error.message,
          fields: error.fields,
        },
        error.status,
      );
    logUnexpectedFailure('results');
    return reply(
      {
        code: 'UNAVAILABLE',
        message:
          'Laboratory results are temporarily unavailable. Please try again.',
      },
      503,
    );
  }
}
function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export async function readResultBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new ResultError(415, 'INVALID_BODY', 'Send a JSON request.');
  const reader = request.body?.getReader();
  if (!reader)
    throw new ResultError(400, 'INVALID_BODY', 'The request is empty.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 32768) {
      await reader.cancel();
      throw new ResultError(413, 'INVALID_BODY', 'The request is too large.');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ResultError(400, 'INVALID_BODY', 'The request could not be read.');
  }
}
