import { database } from '@/lib/db';
import {
  clinicalApi,
  methodNotAllowed,
  readClinicalBody,
} from '@/features/clinical/http';
import { listTemplates } from '@/features/clinical/templates';
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
    'prescription-templates:read',
    async (principal) =>
      listTemplates(database(), principal, await readClinicalBody(request)),
  );
}
