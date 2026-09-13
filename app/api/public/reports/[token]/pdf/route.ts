import { database } from '@/lib/db';
import {
  publicSharePdfApi,
  readRequestCookie,
} from '@/features/reports/http';
import {
  downloadPublicSharePdf,
  shareCookie,
} from '@/features/reports/shares';
export const runtime = 'nodejs';
type Context = { params: Promise<{ token: string }> };
export function DELETE() {
  return new Response(null, {
    status: 405,
    headers: {
      Allow: 'GET',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
export async function GET(request: Request, { params }: Context) {
  return publicSharePdfApi(async () => {
    const client = await database().connect();
    try {
      const { pdf, filename } = await downloadPublicSharePdf(
        client,
        (await params).token,
        readRequestCookie(request, shareCookie),
      );
      return { pdf, filename };
    } finally {
      client.release();
    }
  });
}
