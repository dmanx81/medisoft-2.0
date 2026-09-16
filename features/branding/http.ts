import 'server-only';
import { currentUser } from '@/lib/auth/session';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import { requestOriginHeaders, validRequestOrigin } from '@/lib/validation';
import { environment } from '@/lib/env';
import { BrandingError } from './types';
import { logUnexpectedFailure } from '@/lib/log';
export async function brandingApi(
  request: Request,
  permission: Permission,
  handler: (principal: Principal) => Promise<unknown>,
) {
  try {
    const principal = await currentUser();
    if (!principal)
      throw new BrandingError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    if (!can(principal.role, permission))
      throw new BrandingError(
        403,
        'FORBIDDEN',
        'Your role does not allow this action.',
      );
    if (
      request.method !== 'GET' &&
      !validRequestOrigin(requestOriginHeaders(request), environment().APP_ORIGIN)
    )
      throw new BrandingError(
        403,
        'FORBIDDEN',
        'Request origin was not accepted.',
      );
    return reply(await handler(principal));
  } catch (error) {
    if (error instanceof BrandingError)
      return reply(
        { code: error.code, message: error.message, fields: error.fields },
        error.status,
      );
    logUnexpectedFailure('branding');
    return reply(
      {
        code: 'UNAVAILABLE',
        message: 'Organization settings are temporarily unavailable. Please try again.',
      },
      503,
    );
  }
}
export async function brandingImageApi(
  request: Request,
  permission: Permission,
  handler: (
    principal: Principal,
  ) => Promise<{ bytes: Buffer; filename: string } | null>,
) {
  try {
    const principal = await currentUser();
    if (!principal)
      throw new BrandingError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    if (!can(principal.role, permission))
      throw new BrandingError(
        403,
        'FORBIDDEN',
        'Your role does not allow this action.',
      );
    const image = await handler(principal);
    if (!image)
      return new Response(null, {
        status: 404,
        headers: {
          'Cache-Control': 'private, no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    return new Response(new Uint8Array(image.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `inline; filename="${image.filename}"`,
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof BrandingError)
      return reply(
        { code: error.code, message: error.message, fields: error.fields },
        error.status,
      );
    logUnexpectedFailure('branding');
    return reply(
      {
        code: 'UNAVAILABLE',
        message: 'Organization settings are temporarily unavailable. Please try again.',
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
export async function readBrandingBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new BrandingError(415, 'INVALID_BODY', 'Send a JSON request.');
  const reader = request.body?.getReader();
  if (!reader)
    throw new BrandingError(400, 'INVALID_BODY', 'The request is empty.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 32768) {
      await reader.cancel();
      throw new BrandingError(413, 'INVALID_BODY', 'The request is too large.');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BrandingError(400, 'INVALID_BODY', 'The request could not be read.');
  }
}
export async function readImageUpload(request: Request): Promise<{
  bytes: Buffer;
  filename: string;
}> {
  const type = request.headers.get('content-type') || '';
  if (type.startsWith('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File))
      throw new BrandingError(400, 'VALIDATION', 'Choose an image to upload.');
    if (file.size > 2_097_152)
      throw new BrandingError(
        413,
        'INVALID_BODY',
        'The image is too large. Use a file of 2 MB or less.',
      );
    return {
      bytes: Buffer.from(await file.arrayBuffer()),
      filename: file.name || 'upload',
    };
  }
  if (
    type.startsWith('image/png') ||
    type.startsWith('image/jpeg') ||
    type.startsWith('image/webp')
  ) {
    const raw = Buffer.from(await request.arrayBuffer());
    if (raw.length > 2_097_152)
      throw new BrandingError(
        413,
        'INVALID_BODY',
        'The image is too large. Use a file of 2 MB or less.',
      );
    return { bytes: raw, filename: 'upload' };
  }
  throw new BrandingError(415, 'INVALID_BODY', 'Send an image upload.');
}
export function methodNotAllowed(allow: string) {
  return new Response(null, {
    status: 405,
    headers: {
      Allow: allow,
      'Cache-Control': 'private, no-store',
    },
  });
}
