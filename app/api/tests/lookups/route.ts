import { database } from '@/lib/db';
import { catalogueApi } from '@/features/catalogue/http';
import { listLookups } from '@/features/catalogue/repository';
export const runtime = 'nodejs';
export async function GET(_request: Request) {
  return catalogueApi(_request, 'tests:read', async (principal) =>
    listLookups(database(), principal),
  );
}
