import 'server-only';
import { currentUser } from '@/lib/auth/session';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import { requestOriginHeaders, validRequestOrigin } from '@/lib/validation';
import { environment } from '@/lib/env';
import { DoctorError } from '@/features/doctors/types';
import { PatientError } from '@/features/patients/types';
import { PrescriptionError } from './types';
import { logUnexpectedFailure } from '@/lib/log';
export async function prescriptionApi(
  request: Request,
  permission: Permission,
  handler: (principal: Principal) => Promise<unknown>,
) {
  try {
    const principal = await currentUser();
    if (!principal)
      throw new PrescriptionError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    if (!can(principal.role, permission))
      throw new PrescriptionError(
        403,
        'FORBIDDEN',
        'Your role does not allow this action.',
      );
    if (
      request.method !== 'GET' &&
      !validRequestOrigin(requestOriginHeaders(request), environment().APP_ORIGIN)
    )
      throw new PrescriptionError(
        403,
        'FORBIDDEN',
        'Request origin was not accepted.',
      );
    return reply(await handler(principal));
  } catch (error) {
    if (
      error instanceof PrescriptionError ||
      error instanceof DoctorError ||
      error instanceof PatientError
    )
      return reply(
        {
          code: error.code,
          message: error.message,
          fields: 'fields' in error ? error.fields : {},
        },
        error.status,
      );
    logUnexpectedFailure('prescriptions');
    return reply(
      {
        code: 'UNAVAILABLE',
        message:
          'Prescriptions are temporarily unavailable. Please try again.',
      },
      503,
    );
  }
}
export async function prescriptionPdfApi(
  request: Request,
  permission: Permission,
  handler: (
    principal: Principal,
  ) => Promise<{ pdf: Buffer; filename: string }>,
) {
  try {
    const principal = await currentUser();
    if (!principal)
      throw new PrescriptionError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    if (!can(principal.role, permission))
      throw new PrescriptionError(
        403,
        'FORBIDDEN',
        'Your role does not allow this action.',
      );
    const { pdf, filename } = await handler(principal);
    const mode = new URL(request.url).searchParams.get('mode');
    const disposition = mode === 'preview' ? 'inline' : 'attachment';
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof PrescriptionError)
      return reply(
        { code: error.code, message: error.message, fields: error.fields },
        error.status,
      );
    logUnexpectedFailure('prescriptions');
    return reply(
      {
        code: 'UNAVAILABLE',
        message:
          'Prescriptions are temporarily unavailable. Please try again.',
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
export async function readPrescriptionBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new PrescriptionError(415, 'INVALID_BODY', 'Send a JSON request.');
  const reader = request.body?.getReader();
  if (!reader)
    throw new PrescriptionError(400, 'INVALID_BODY', 'The request is empty.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 65536) {
      await reader.cancel();
      throw new PrescriptionError(413, 'INVALID_BODY', 'The request is too large.');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new PrescriptionError(
      400,
      'INVALID_BODY',
      'The request could not be read.',
    );
  }
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
