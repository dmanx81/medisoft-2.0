import { database } from '@/lib/db';
import { patientApi } from '@/features/patients/http';
import { patientActivity } from '@/features/patients/repository';
export const runtime = 'nodejs';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return patientApi(request, 'patients:activity', async (principal) =>
    patientActivity(
      database(),
      principal,
      (await params).id,
      Number(new URL(request.url).searchParams.get('page') ?? 1),
    ),
  );
}
