import type { QueryRunner } from '@/lib/db/query';
import { can, type Principal } from '@/lib/auth/permissions';
import type { LabReport } from './types';

export const reportSelect = `r.id,r.organization_id,r.order_id,r.patient_id,r.report_number,
 r.report_version,r.status,r.issued_at::text,r.issued_by,COALESCE(iss.name,'') AS issued_by_name,
 COALESCE(r.supersedes_id::text,'') AS supersedes_id,
 COALESCE(r.successor_id::text,'') AS successor_id,r.is_current,r.version,
 r.created_at::text,r.created_by,r.updated_at::text,r.updated_by`;

export function mapReport(row: LabReport): LabReport {
  return { ...row, is_current: Boolean(row.is_current) };
}

export async function listReportsForOrder(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
): Promise<LabReport[]> {
  if (!can(principal.role, 'reports:read')) return [];
  return (
    await db.query<LabReport>(
      `SELECT ${reportSelect}
 FROM lab_reports r
 JOIN users iss ON iss.organization_id=r.organization_id AND iss.id=r.issued_by
 WHERE r.organization_id=$1 AND r.order_id=$2
 ORDER BY r.report_version`,
      [principal.organizationId, orderId],
    )
  ).rows.map(mapReport);
}
