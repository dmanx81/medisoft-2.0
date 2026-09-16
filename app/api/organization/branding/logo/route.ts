import { database } from '@/lib/db';
import { clinicalApi, methodNotAllowed } from '@/features/clinical/http';
import { ClinicalError } from '@/features/clinical/types';
import {
  getOrganizationLogo,
  saveOrganizationLogo,
} from '@/features/clinical/branding';
export const runtime = 'nodejs';
export function DELETE() {
  return methodNotAllowed('GET, POST');
}
export async function GET(request: Request) {
  return clinicalApi(request, 'settings:read', async (principal) => {
    const logo = await getOrganizationLogo(database(), principal);
    return new Response(new Uint8Array(logo.bytes), {
      status: 200,
      headers: {
        'Content-Type': logo.content_type,
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'inline; filename="organization-logo"',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}
export async function POST(request: Request) {
  return clinicalApi(request, 'settings:read', async (principal) => {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.startsWith('multipart/form-data'))
      throw new ClinicalError(415, 'INVALID_BODY', 'Upload the logo as a file.');
    const form = await request.formData();
    const file = form.get('logo');
    if (!(file instanceof File))
      throw new ClinicalError(400, 'VALIDATION', 'Choose a logo image to upload.', {
        logo: 'A logo file is required.',
      });
    if (file.size < 32 || file.size > 262144)
      throw new ClinicalError(
        400,
        'VALIDATION',
        'Logo files must be between 32 bytes and 256 KB.',
        { logo: 'Choose a smaller image.' },
      );
    const bytes = Buffer.from(await file.arrayBuffer());
    const client = await database().connect();
    try {
      return await saveOrganizationLogo(client, principal, {
        type: file.type,
        bytes,
        name: file.name,
      });
    } finally {
      client.release();
    }
  });
}
