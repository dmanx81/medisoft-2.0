import { database } from '@/lib/db';
import { clinicalApi, methodNotAllowed } from '@/features/clinical/http';
import { ClinicalError } from '@/features/clinical/types';
import { saveDoctorSignature } from '@/features/clinical/doctors';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function GET() {
  return methodNotAllowed('POST');
}
export function DELETE() {
  return methodNotAllowed('POST');
}
export async function POST(request: Request, { params }: Context) {
  return clinicalApi(request, 'doctors:manage', async (principal) => {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.startsWith('multipart/form-data'))
      throw new ClinicalError(415, 'INVALID_BODY', 'Upload the signature as a file.');
    const form = await request.formData();
    const file = form.get('signature');
    if (!(file instanceof File))
      throw new ClinicalError(400, 'VALIDATION', 'Choose a signature image.', {
        logo: 'A signature file is required.',
      });
    if (file.size < 32 || file.size > 262144)
      throw new ClinicalError(
        400,
        'VALIDATION',
        'Signature files must be between 32 bytes and 256 KB.',
        { logo: 'Choose a smaller image.' },
      );
    const bytes = Buffer.from(await file.arrayBuffer());
    const client = await database().connect();
    try {
      return await saveDoctorSignature(client, principal, (await params).id, {
        type: file.type,
        bytes,
        name: file.name,
      });
    } finally {
      client.release();
    }
  });
}
