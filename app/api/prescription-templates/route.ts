import { database } from '@/lib/db';
import {
  clinicalApi,
  methodNotAllowed,
  readClinicalBody,
} from '@/features/clinical/http';
import { createTemplate } from '@/features/clinical/templates';
export const runtime = 'nodejs';
export function GET() {
  return methodNotAllowed('POST');
}
export function DELETE() {
  return methodNotAllowed('POST');
}
export async function POST(request: Request) {
  return clinicalApi(
    request,
    'prescription-templates:manage',
    async (principal) => {
      const body = await readClinicalBody(request);
      const client = await database().connect();
      try {
        return await createTemplate(client, principal, body);
      } finally {
        client.release();
      }
    },
  );
}
