import { database } from '@/lib/db';
import { catalogueApi, readCatalogueBody } from '@/features/catalogue/http';
import { createRange, listRanges } from '@/features/catalogue/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return catalogueApi(request, 'tests:read', async (principal) =>
    listRanges(database(), principal, (await params).id),
  );
}
export async function POST(request: Request, { params }: Context) {
  return catalogueApi(request, 'tests:edit', async (principal) => {
    const { id } = await params;
    const body = await readCatalogueBody(request);
    const client = await database().connect();
    try {
      return await createRange(client, principal, id, body);
    } finally {
      client.release();
    }
  });
}
