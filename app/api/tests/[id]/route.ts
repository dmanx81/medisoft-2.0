import { database } from '@/lib/db';
import { catalogueApi, readCatalogueBody } from '@/features/catalogue/http';
import { getTest, updateTest } from '@/features/catalogue/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return catalogueApi(request, 'tests:read', async (principal) =>
    getTest(database(), principal, (await params).id),
  );
}
export async function PATCH(request: Request, { params }: Context) {
  return catalogueApi(request, 'tests:edit', async (principal) => {
    const { id } = await params;
    const body = await readCatalogueBody(request);
    const client = await database().connect();
    try {
      return await updateTest(client, principal, id, body);
    } finally {
      client.release();
    }
  });
}
