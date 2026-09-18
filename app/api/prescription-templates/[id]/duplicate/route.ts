import { database } from '@/lib/db';
import { clinicalApi, methodNotAllowed } from '@/features/clinical/http';
import { duplicateTemplate } from '@/features/clinical/templates';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function GET() {
  return methodNotAllowed('POST');
}
export function DELETE() {
  return methodNotAllowed('POST');
}
export async function POST(request: Request, { params }: Context) {
  return clinicalApi(
    request,
    'prescription-templates:manage',
    async (principal) => {
      const client = await database().connect();
      try {
        return await duplicateTemplate(client, principal, (await params).id);
      } finally {
        client.release();
      }
    },
  );
}
