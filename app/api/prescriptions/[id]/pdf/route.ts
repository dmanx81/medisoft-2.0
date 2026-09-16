import { database } from '@/lib/db';
import { prescriptionPdfApi } from '@/features/prescriptions/http';
import { downloadPrescriptionPdf } from '@/features/prescriptions/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return prescriptionPdfApi(request, 'prescriptions:download', async (principal) => {
    const client = await database().connect();
    try {
      const { pdf, filename } = await downloadPrescriptionPdf(
        client,
        principal,
        (await params).id,
      );
      return { pdf, filename };
    } finally {
      client.release();
    }
  });
}
