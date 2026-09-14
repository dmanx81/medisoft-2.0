import 'server-only';
import { currentUser } from '@/lib/auth/session';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import { validOrigin } from '@/lib/validation';
import { environment } from '@/lib/env';
import { CatalogueError } from './types';
import { logUnexpectedFailure } from '@/lib/log';
export async function catalogueApi(
  request: Request,
  permission: Permission,
  handler: (principal: Principal) => Promise<unknown>,
) {
  try {
    const principal = await currentUser();
    if (!principal)
      throw new CatalogueError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    if (!can(principal.role, permission))
      throw new CatalogueError(
        403,
        'FORBIDDEN',
        'Your role does not allow this action.',
      );
    if (
      request.method !== 'GET' &&
      !validOrigin(request.headers.get('origin'), environment().APP_ORIGIN)
    )
      throw new CatalogueError(
        403,
        'FORBIDDEN',
        'Request origin was not accepted.',
      );
    return reply(await handler(principal));
  } catch (error) {
    if (error instanceof CatalogueError)
      return reply(
        {
          code: error.code,
          message: error.message,
          fields: error.fields,
        },
        error.status,
      );
    logUnexpectedFailure('catalogue');
    return reply(
      {
        code: 'UNAVAILABLE',
        message:
          'The laboratory catalogue is temporarily unavailable. Please try again.',
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
export async function readCatalogueBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new CatalogueError(415, 'INVALID_BODY', 'Send a JSON request.');
  const reader = request.body?.getReader();
  if (!reader)
    throw new CatalogueError(400, 'INVALID_BODY', 'The request is empty.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 32768) {
      await reader.cancel();
      throw new CatalogueError(413, 'INVALID_BODY', 'The request is too large.');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new CatalogueError(
      400,
      'INVALID_BODY',
      'The request could not be read.',
    );
  }
}
