import 'server-only';
import { currentUser } from '@/lib/auth/session';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import { requestOriginHeaders, validRequestOrigin } from '@/lib/validation';
import { environment } from '@/lib/env';
import type { QueryRunner } from '@/lib/db/query';
import { listResultsForOrder } from '@/features/results/repository';
import { listReportsForOrder } from '@/features/reports/list';
import { OrderError, type LabOrder } from './types';
import { ResultError } from '@/features/results/types';
import { logUnexpectedFailure } from '@/lib/log';
import { ReportError } from '@/features/reports/types';
export async function orderApi(
  request: Request,
  permission: Permission,
  handler: (principal: Principal) => Promise<unknown>,
) {
  try {
    const principal = await currentUser();
    if (!principal)
      throw new OrderError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    if (!can(principal.role, permission))
      throw new OrderError(
        403,
        'FORBIDDEN',
        'Your role does not allow this action.',
      );
    if (
      request.method !== 'GET' &&
      !validRequestOrigin(requestOriginHeaders(request), environment().APP_ORIGIN)
    )
      throw new OrderError(
        403,
        'FORBIDDEN',
        'Request origin was not accepted.',
      );
    return reply(await handler(principal));
  } catch (error) {
    if (
      error instanceof OrderError ||
      error instanceof ResultError ||
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
    logUnexpectedFailure('orders');
    return reply(
      {
        code: 'UNAVAILABLE',
        message:
          'Laboratory orders are temporarily unavailable. Please try again.',
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
export async function attachResults(
  db: QueryRunner,
  principal: Principal,
  order: LabOrder,
) {
  order.results = await listResultsForOrder(db, principal, order.id);
  order.reports = await listReportsForOrder(db, principal, order.id);
  return order;
}
export async function readOrderBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new OrderError(415, 'INVALID_BODY', 'Send a JSON request.');
  const reader = request.body?.getReader();
  if (!reader)
    throw new OrderError(400, 'INVALID_BODY', 'The request is empty.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 32768) {
      await reader.cancel();
      throw new OrderError(413, 'INVALID_BODY', 'The request is too large.');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new OrderError(400, 'INVALID_BODY', 'The request could not be read.');
  }
}
