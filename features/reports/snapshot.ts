import type { QueryRunner } from '@/lib/db/query';
import type { Principal } from '@/lib/auth/permissions';
import { displayRangeBounds, displayResultValue } from '@/features/results/format';
import type { LabReportSnapshot } from './types';

export async function buildReportSnapshot(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
): Promise<LabReportSnapshot> {
  const organization = (
    await db.query<{
      name: string;
      slug: string;
      type: string;
      address: string;
      phone: string;
      email: string;
      country: string;
    }>(
      `SELECT name,slug,type,COALESCE(address,'') AS address,COALESCE(phone,'') AS phone,
 COALESCE(email,'') AS email,country FROM organizations WHERE id=$1`,
      [principal.organizationId],
    )
  ).rows[0];
  const order = (
    await db.query<{
      order_number: string;
      status: string;
      priority: string;
      ordered_at: string;
      ordered_by_name: string;
      ordering_physician_name: string;
      clinical_notes: string;
      fasting_status: string;
      external_reference: string;
      patient_number: string;
      first_name: string;
      last_name: string;
      date_of_birth: string;
      sex: string;
    }>(
      `SELECT o.order_number,o.status,o.priority,COALESCE(o.ordered_at::text,'') AS ordered_at,
 COALESCE(ob.name,'') AS ordered_by_name,o.ordering_physician_name,o.clinical_notes,
 o.fasting_status,o.external_reference,p.patient_number,p.first_name,p.last_name,
 COALESCE(p.date_of_birth::text,'') AS date_of_birth,p.sex
 FROM lab_orders o
 JOIN patients p ON p.organization_id=o.organization_id AND p.id=o.patient_id
 LEFT JOIN users ob ON ob.organization_id=o.organization_id AND ob.id=o.ordered_by
 WHERE o.organization_id=$1 AND o.id=$2`,
      [principal.organizationId, orderId],
    )
  ).rows[0];
  const specimens = (
    await db.query<{
      accession_number: string;
      specimen_type: string;
      status: string;
      collected_at: string;
      collected_by_name: string;
      received_at: string;
      received_by_name: string;
    }>(
      `SELECT s.accession_number,s.specimen_type,s.status,COALESCE(s.collected_at::text,'') AS collected_at,
 COALESCE(col.name,'') AS collected_by_name,COALESCE(s.received_at::text,'') AS received_at,
 COALESCE(rec.name,'') AS received_by_name
 FROM lab_specimens s
 JOIN users col ON col.organization_id=s.organization_id AND col.id=s.collected_by
 LEFT JOIN users rec ON rec.organization_id=s.organization_id AND rec.id=s.received_by
 WHERE s.organization_id=$1 AND s.order_id=$2
 ORDER BY s.created_at,s.accession_number`,
      [principal.organizationId, orderId],
    )
  ).rows;
  const results = (
    await db.query<{
      order_test_id: string;
      result_id: string;
      result_version: string;
      test_code: string;
      test_name: string;
      result_type: string;
      numeric_value: string;
      text_value: string;
      boolean_value: string;
      unit_symbol: string;
      method: string;
      flag: string;
      range_lower: string;
      range_upper: string;
      range_lower_operator: string;
      range_upper_operator: string;
      range_text: string;
      range_unit: string;
      technically_validated_at: string;
      technically_validated_by_name: string;
      clinically_verified_at: string;
      clinically_verified_by_name: string;
      supersedes_id: string;
      amendment_reason: string;
    }>(
      `SELECT t.id AS order_test_id,r.id AS result_id,r.version::text AS result_version,
 t.code_snapshot AS test_code,t.name_snapshot AS test_name,r.result_type_snapshot AS result_type,
 COALESCE(r.numeric_value::text,'') AS numeric_value,r.text_value,
 COALESCE(r.boolean_value::text,'') AS boolean_value,r.unit_symbol_snapshot AS unit_symbol,
 r.method_snapshot AS method,r.flag,
 COALESCE(r.range_lower_snapshot::text,'') AS range_lower,
 COALESCE(r.range_upper_snapshot::text,'') AS range_upper,
 r.range_lower_operator_snapshot AS range_lower_operator,
 r.range_upper_operator_snapshot AS range_upper_operator,r.range_text_snapshot AS range_text,
 r.range_unit_symbol_snapshot AS range_unit,
 COALESCE(r.technically_validated_at::text,'') AS technically_validated_at,
 COALESCE(val.name,'') AS technically_validated_by_name,
 COALESCE(r.clinically_verified_at::text,'') AS clinically_verified_at,
 COALESCE(ver.name,'') AS clinically_verified_by_name,
 COALESCE(r.supersedes_id::text,'') AS supersedes_id,r.amendment_reason
 FROM lab_order_tests t
 JOIN lab_results r ON r.organization_id=t.organization_id AND r.order_test_id=t.id AND r.is_current
 LEFT JOIN users val ON val.organization_id=r.organization_id AND val.id=r.technically_validated_by
 LEFT JOIN users ver ON ver.organization_id=r.organization_id AND ver.id=r.clinically_verified_by
 WHERE t.organization_id=$1 AND t.order_id=$2 AND t.status='ACTIVE'
  AND r.status='CLINICALLY_VERIFIED'
 ORDER BY t.created_at,t.id`,
      [principal.organizationId, orderId],
    )
  ).rows;
  return {
    schema_version: 1,
    organization: {
      name: organization?.name ?? principal.organizationName,
      slug: organization?.slug ?? '',
      type: organization?.type ?? '',
      address: organization?.address ?? '',
      phone: organization?.phone ?? '',
      email: organization?.email ?? '',
      country: organization?.country ?? '',
    },
    patient: {
      patient_number: order?.patient_number ?? '',
      first_name: order?.first_name ?? '',
      last_name: order?.last_name ?? '',
      date_of_birth: order?.date_of_birth ?? '',
      sex: order?.sex ?? 'UNKNOWN',
    },
    order: {
      order_number: order?.order_number ?? '',
      status: order?.status ?? '',
      priority: order?.priority ?? '',
      ordered_at: order?.ordered_at ?? '',
      ordered_by_name: order?.ordered_by_name ?? '',
      ordering_physician_name: order?.ordering_physician_name ?? '',
      clinical_notes: order?.clinical_notes ?? '',
      fasting_status: order?.fasting_status ?? '',
      external_reference: order?.external_reference ?? '',
    },
    specimens,
    results: results.map((row) => ({
      order_test_id: row.order_test_id,
      result_id: row.result_id,
      result_version: Number(row.result_version),
      test_code: row.test_code,
      test_name: row.test_name,
      result_type: row.result_type,
      result_display: displayResultValue({
        result_type_snapshot: row.result_type,
        numeric_value: row.numeric_value,
        text_value: row.text_value,
        boolean_value: row.boolean_value,
        unit_symbol_snapshot: row.unit_symbol,
      }),
      numeric_value: row.numeric_value,
      text_value: row.text_value,
      boolean_value: row.boolean_value,
      unit_symbol: row.unit_symbol,
      method: row.method,
      flag: row.flag,
      reference_range_display: displayRangeBounds({
        range_lower_snapshot: row.range_lower,
        range_upper_snapshot: row.range_upper,
        range_lower_operator_snapshot: row.range_lower_operator,
        range_upper_operator_snapshot: row.range_upper_operator,
        range_text_snapshot: row.range_text,
        range_unit_symbol_snapshot: row.range_unit,
      }),
      range_lower: row.range_lower,
      range_upper: row.range_upper,
      range_text: row.range_text,
      technically_validated_at: row.technically_validated_at,
      technically_validated_by_name: row.technically_validated_by_name,
      clinically_verified_at: row.clinically_verified_at,
      clinically_verified_by_name: row.clinically_verified_by_name,
      is_amendment: Boolean(row.supersedes_id),
      amendment_reason: row.amendment_reason,
    })),
  };
}

export function snapshotResultIds(snapshot: LabReportSnapshot): string[] {
  return snapshot.results.map((row) => row.result_id).sort();
}
