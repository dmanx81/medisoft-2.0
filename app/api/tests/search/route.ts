import { database } from '@/lib/db';
import { catalogueApi, readCatalogueBody } from '@/features/catalogue/http';
import { listTests } from '@/features/catalogue/repository';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return catalogueApi(request, 'tests:read', async (principal) =>
    listTests(database(), principal, await readCatalogueBody(request)),
  );
}
