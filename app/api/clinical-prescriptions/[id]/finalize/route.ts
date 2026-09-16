import { database } from '@/lib/db';
import { clinicalApi, methodNotAllowed, readClinicalBody } from '@/features/clinical/http';
import { finalizePrescription } from '@/features/clinical/prescriptions';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function GET() {
  return methodNotAllowed('POST');
}
export function DELETE() {
  return methodNotAllowed('POST');
}
export async function POST(request: Request, { params }: Context) {
  return clinicalApi(request, 'prescriptions:finalize', async (principal) => {
    const body = await readClinicalBody(request);
    const client = await database().connect();
    try {
      return await finalizePrescription(client, principal, (await params).id, body);
    } finally {
      client.release();
    }
  });
}
