import { database } from '@/lib/db';
import {
  clinicalApi,
  methodNotAllowed,
  readClinicalBody,
} from '@/features/clinical/http';
import {
  deleteTemplate,
  getTemplate,
  updateTemplate,
} from '@/features/clinical/templates';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function PUT() {
  return methodNotAllowed('GET, PATCH, DELETE');
}
export async function GET(request: Request, { params }: Context) {
  return clinicalApi(request, 'prescription-templates:read', async (principal) =>
    getTemplate(database(), principal, (await params).id),
  );
}
export async function PATCH(request: Request, { params }: Context) {
  return clinicalApi(
    request,
    'prescription-templates:manage',
    async (principal) => {
      const body = await readClinicalBody(request);
      const client = await database().connect();
      try {
        return await updateTemplate(
          client,
          principal,
          (await params).id,
          body,
        );
      } finally {
        client.release();
      }
    },
  );
}
export async function DELETE(request: Request, { params }: Context) {
  return clinicalApi(
    request,
    'prescription-templates:manage',
    async (principal) => {
      const client = await database().connect();
      try {
        return await deleteTemplate(client, principal, (await params).id);
      } finally {
        client.release();
      }
    },
  );
}
