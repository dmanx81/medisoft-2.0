import { database } from '@/lib/db';
import { billingApi, methodNotAllowed } from '@/features/billing/http';
import { getCreditNote } from '@/features/billing/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function DELETE() {
  return methodNotAllowed('GET');
}
export async function GET(request: Request, { params }: Context) {
  return billingApi(request, 'billing:read', async (principal) =>
    getCreditNote(database(), principal, (await params).id),
  );
}
