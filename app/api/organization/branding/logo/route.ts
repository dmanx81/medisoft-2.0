import { database } from '@/lib/db';
import {
  brandingApi,
  brandingImageApi,
  methodNotAllowed,
  readImageUpload,
} from '@/features/branding/http';
import {
  clearLogo,
  getLogoAsset,
  upsertLogo,
} from '@/features/branding/repository';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return brandingImageApi(request, 'settings:read', async (principal) => {
    const asset = await getLogoAsset(database(), principal);
    if (!asset) return null;
    const bytes = Buffer.isBuffer(asset.bytes)
      ? asset.bytes
      : Buffer.from(asset.bytes);
    return { bytes, filename: 'organization-logo.png' };
  });
}
export async function PUT(request: Request) {
  return brandingApi(request, 'settings:edit', async (principal) => {
    const upload = await readImageUpload(request);
    const client = await database().connect();
    try {
      return await upsertLogo(client, principal, upload);
    } finally {
      client.release();
    }
  });
}
export async function DELETE(request: Request) {
  return brandingApi(request, 'settings:edit', async (principal) => {
    const client = await database().connect();
    try {
      return await clearLogo(client, principal);
    } finally {
      client.release();
    }
  });
}
export function POST() {
  return methodNotAllowed('GET, PUT, DELETE');
}
