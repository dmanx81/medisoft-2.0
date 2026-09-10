import { database } from '@/lib/db';
import { catalogueApi, readCatalogueBody } from '@/features/catalogue/http';
import { createTest } from '@/features/catalogue/repository';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return catalogueApi(request, 'tests:create', async (principal) => {
    const body = await readCatalogueBody(request);
    const client = await database().connect();
    try {
      return await createTest(client, principal, body);
    } finally {
      client.release();
    }
  });
}
