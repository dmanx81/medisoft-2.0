import { database } from '@/lib/db';
import { catalogueApi, readCatalogueBody } from '@/features/catalogue/http';
import { retireRange } from '@/features/catalogue/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string; rangeId: string }> };
export async function POST(request: Request, { params }: Context) {
  return catalogueApi(request, 'tests:edit', async (principal) => {
    const { id, rangeId } = await params;
    const body = await readCatalogueBody(request);
    const client = await database().connect();
    try {
      return await retireRange(client, principal, id, rangeId, body);
    } finally {
      client.release();
    }
  });
}
