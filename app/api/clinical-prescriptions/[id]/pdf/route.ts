import { database } from '@/lib/db';
import { clinicalPdfApi, methodNotAllowed } from '@/features/clinical/http';
import { downloadPrescriptionPdf } from '@/features/clinical/prescriptions';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function DELETE() {
  return methodNotAllowed('GET');
}
export async function GET(request: Request, { params }: Context) {
  return clinicalPdfApi(request, 'prescriptions:download', async (principal) => {
    const client = await database().connect();
    try {
      return await downloadPrescriptionPdf(client, principal, (await params).id);
    } finally {
      client.release();
    }
  });
}
