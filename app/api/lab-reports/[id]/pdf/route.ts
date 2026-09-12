import { database } from '@/lib/db';
import { reportPdfApi } from '@/features/reports/http';
import { downloadReportPdf } from '@/features/reports/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return reportPdfApi(request, 'reports:download', async (principal) => {
    const client = await database().connect();
    try {
      const { report, pdf } = await downloadReportPdf(
        client,
        principal,
        (await params).id,
      );
      return {
        pdf,
        filename: `${report.report_number}.pdf`,
      };
    } finally {
      client.release();
    }
  });
}
