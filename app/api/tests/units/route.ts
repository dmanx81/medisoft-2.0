import { database } from '@/lib/db';
import { catalogueApi, readCatalogueBody } from '@/features/catalogue/http';
import { createUnit } from '@/features/catalogue/repository';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return catalogueApi(request, 'tests:edit', async (principal) => {
    const body = await readCatalogueBody(request);
    const client = await database().connect();
    try {
      return await createUnit(client, principal, body);
    } finally {
      client.release();
    }
  });
}
