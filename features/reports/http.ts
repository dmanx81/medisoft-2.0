import 'server-only';
import { currentUser } from '@/lib/auth/session';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import { requestOriginHeaders, validRequestOrigin } from '@/lib/validation';
import { environment } from '@/lib/env';
import { OrderError } from '@/features/orders/types';
import { ResultError } from '@/features/results/types';
import { ReportError } from './types';
import { logUnexpectedFailure } from '@/lib/log';
export async function reportApi(
  request: Request,
  permission: Permission,
  handler: (principal: Principal) => Promise<unknown>,
) {
  try {
    const principal = await currentUser();
    if (!principal)
      throw new ReportError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    if (!can(principal.role, permission))
      throw new ReportError(
        403,
        'FORBIDDEN',
        'Your role does not allow this action.',
      );
    if (
      request.method !== 'GET' &&
      !validRequestOrigin(requestOriginHeaders(request), environment().APP_ORIGIN)
    )
      throw new ReportError(
        403,
        'FORBIDDEN',
        'Request origin was not accepted.',
      );
    return reply(await handler(principal));
  } catch (error) {
    if (
      error instanceof ReportError ||
      error instanceof OrderError ||
      error instanceof ResultError
    )
      return reply(
        {
          code: error.code,
          message: error.message,
          fields: error.fields,
        },
        error.status,
      );
    logUnexpectedFailure('reports');
    return reply(
      {
        code: 'UNAVAILABLE',
        message:
          'Laboratory reports are temporarily unavailable. Please try again.',
      },
      503,
    );
  }
}
export async function reportPdfApi(
  request: Request,
  permission: Permission,
  handler: (
    principal: Principal,
  ) => Promise<{ pdf: Buffer; filename: string }>,
) {
  try {
    const principal = await currentUser();
    if (!principal)
      throw new ReportError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    if (!can(principal.role, permission))
      throw new ReportError(
        403,
        'FORBIDDEN',
        'Your role does not allow this action.',
      );
    const { pdf, filename } = await handler(principal);
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (
      error instanceof ReportError ||
      error instanceof OrderError ||
      error instanceof ResultError
    )
      return reply(
        {
          code: error.code,
          message: error.message,
          fields: error.fields,
        },
        error.status,
      );
    logUnexpectedFailure('reports');
    return reply(
      {
        code: 'UNAVAILABLE',
        message:
          'Laboratory reports are temporarily unavailable. Please try again.',
      },
      503,
    );
  }
}
function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: publicSecurityHeaders(),
  });
}
export function publicSecurityHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  };
}
export function readRequestCookie(
  request: Request,
  name: string,
): string | undefined {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
}
export async function publicShareApi(
  request: Request,
  handler: () => Promise<unknown>,
  options: { checkOrigin?: boolean } = {},
) {
  try {
    if (
      options.checkOrigin &&
      request.method !== 'GET' &&
      !validRequestOrigin(requestOriginHeaders(request), environment().APP_ORIGIN)
    )
      throw new ReportError(
        403,
        'FORBIDDEN',
        'Request origin was not accepted.',
      );
    const result = await handler();
    if (result instanceof Response) return result;
    return reply(result);
  } catch (error) {
    if (error instanceof ReportError)
      return reply(
        {
          code: error.code,
          message: error.message,
          fields: error.fields,
        },
        error.status,
      );
    logUnexpectedFailure('report-share');
    return reply(
      {
        code: 'UNAVAILABLE',
        message: 'This report link is unavailable. Please try again later.',
      },
      503,
    );
  }
}
export async function publicSharePdfApi(
  handler: () => Promise<{ pdf: Buffer; filename: string }>,
) {
  try {
    const { pdf, filename } = await handler();
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        ...publicSecurityHeaders(),
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ReportError)
      return reply(
        {
          code: error.code,
          message: error.message,
          fields: error.fields,
        },
        error.status,
      );
    logUnexpectedFailure('report-share');
    return reply(
      {
        code: 'UNAVAILABLE',
        message: 'This report link is unavailable. Please try again later.',
      },
      503,
    );
  }
}
export async function readReportBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new ReportError(415, 'INVALID_BODY', 'Send a JSON request.');
  const reader = request.body?.getReader();
  if (!reader)
    throw new ReportError(400, 'INVALID_BODY', 'The request is empty.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 32768) {
      await reader.cancel();
      throw new ReportError(413, 'INVALID_BODY', 'The request is too large.');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ReportError(400, 'INVALID_BODY', 'The request could not be read.');
  }
}
