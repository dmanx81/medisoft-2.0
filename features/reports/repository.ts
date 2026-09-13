import type { QueryRunner } from '@/lib/db/query';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import { getOrder } from '@/features/orders/repository';
import { listResultsForOrder } from '@/features/results/repository';
import { OrderError, type LabOrder } from '@/features/orders/types';
import { ResultError } from '@/features/results/types';
import { orderCompletionState } from './completion';
import { attachIssuance } from './clinical';
import { buildReportSnapshot, snapshotResultIds } from './snapshot';
import { renderReportPdf } from './pdf';
import { listReportsForOrder, mapReport, reportSelect } from './list';
import {
  deliverReportSchema,
  fieldErrors,
  generateReportSchema,
  reportIdSchema,
  searchSchema,
} from './validation';
import {
  ReportError,
  type LabReport,
  type LabReportSnapshot,
  type ReportContext,
  type ReportDelivery,
  type ReportWorkItem,
} from './types';

function permit(principal: Principal, permission: Permission) {
  if (!principal.organizationId || !can(principal.role, permission))
    throw new ReportError(
      403,
      'FORBIDDEN',
      'Your role does not allow this action.',
    );
}
function idValue(id: string, code = 'REPORT_NOT_FOUND', label = 'Report') {
  if (!reportIdSchema.safeParse(id).success)
    throw new ReportError(404, code, `${label} not found.`);
  return id;
}
function notFound(code = 'REPORT_NOT_FOUND', label = 'Report'): never {
  throw new ReportError(404, code, `${label} not found.`);
}
function invalid(error: Parameters<typeof fieldErrors>[0]): never {
  throw new ReportError(
    400,
    'VALIDATION',
    'Check the highlighted fields.',
    fieldErrors(error),
  );
}
function asOrderError(error: unknown): never {
  if (error instanceof OrderError)
    throw new ReportError(error.status, error.code, error.message, error.fields);
  if (error instanceof ResultError)
    throw new ReportError(error.status, error.code, error.message, error.fields);
  throw error;
}
async function audit(
  db: QueryRunner,
  principal: Principal,
  entityType: string,
  id: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  await db.query(
    `INSERT INTO audit_events(organization_id,user_id,action,entity_type,entity_id,metadata,session_hash)
 VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      principal.organizationId,
      principal.userId,
      action,
      entityType,
      id,
      JSON.stringify(metadata),
      principal.sessionHash,
    ],
  );
}
async function transaction<T>(
  db: QueryRunner,
  work: () => Promise<T>,
): Promise<T> {
  await db.query('BEGIN');
  try {
    const result = await work();
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

export async function orderWithReports(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
): Promise<LabOrder> {
  try {
    const order = await getOrder(db, principal, orderId);
    order.results = await listResultsForOrder(db, principal, order.id);
    order.reports = await listReportsForOrder(db, principal, order.id);
    return order;
  } catch (error) {
    asOrderError(error);
  }
}

async function loadReport(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<LabReport> {
  const row = (
    await db.query<LabReport>(
      `SELECT ${reportSelect}
 FROM lab_reports r
 JOIN users iss ON iss.organization_id=r.organization_id AND iss.id=r.issued_by
 WHERE r.organization_id=$1 AND r.id=$2`,
      [principal.organizationId, idValue(id)],
    )
  ).rows[0];
  return row ? mapReport(row) : notFound();
}

async function loadSnapshot(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<{ report: LabReport; snapshot: LabReportSnapshot }> {
  const row = (
    await db.query<LabReport & { snapshot: LabReportSnapshot | string }>(
      `SELECT ${reportSelect},r.snapshot
 FROM lab_reports r
 JOIN users iss ON iss.organization_id=r.organization_id AND iss.id=r.issued_by
 WHERE r.organization_id=$1 AND r.id=$2`,
      [principal.organizationId, idValue(id)],
    )
  ).rows[0];
  if (!row) notFound();
  const snapshot =
    typeof row.snapshot === 'string'
      ? (JSON.parse(row.snapshot) as LabReportSnapshot)
      : row.snapshot;
  const { snapshot: _ignored, ...report } = row;
  return { report: mapReport(report), snapshot };
}

export async function getReportContext(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
): Promise<ReportContext> {
  permit(principal, 'reports:read');
  let order: LabOrder;
  try {
    order = await getOrder(db, principal, orderId);
  } catch (error) {
    asOrderError(error);
  }
  const state = await orderCompletionState(db, principal, order.id);
  const reports = await listReportsForOrder(db, principal, order.id);
  const current = reports.find((row) => row.is_current) ?? null;
  let needsNew = false;
  if (state.complete && current) {
    const live = await buildReportSnapshot(db, principal, order.id);
    const stored = (
      await db.query<{ snapshot: LabReportSnapshot | string }>(
        `SELECT snapshot FROM lab_reports WHERE organization_id=$1 AND id=$2`,
        [principal.organizationId, current.id],
      )
    ).rows[0];
    const previous =
      typeof stored?.snapshot === 'string'
        ? (JSON.parse(stored.snapshot) as LabReportSnapshot)
        : stored?.snapshot;
    needsNew =
      JSON.stringify(snapshotResultIds(live)) !==
      JSON.stringify(previous ? snapshotResultIds(previous) : []);
  }
  return {
    order_id: order.id,
    order_status: order.status,
    order_version: Number(order.version),
    complete: state.complete,
    eligible: state.complete && (!current || needsNew),
    needs_new_report: needsNew,
    blocking: state.blocking,
    current_report: current,
    reports,
  };
}

export async function getReport(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<LabReport> {
  permit(principal, 'reports:read');
  return loadReport(db, principal, id);
}

export async function listOrderReports(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
): Promise<LabReport[]> {
  permit(principal, 'reports:read');
  try {
    await getOrder(db, principal, orderId);
  } catch (error) {
    asOrderError(error);
  }
  return listReportsForOrder(db, principal, orderId);
}

export async function generateReport(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
  input: unknown,
): Promise<LabOrder> {
  permit(principal, 'reports:generate');
  permit(principal, 'reports:read');
  const parsed = generateReportSchema.safeParse(input ?? {});
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    const locked = (
      await db.query<{
        id: string;
        patient_id: string;
        order_number: string;
        status: string;
      }>(
        `SELECT id,patient_id,order_number,status FROM lab_orders
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(orderId, 'ORDER_NOT_FOUND', 'Order')],
      )
    ).rows[0];
    if (!locked) notFound('ORDER_NOT_FOUND', 'Order');
    const state = await orderCompletionState(db, principal, locked.id);
    if (!state.complete)
      throw new ReportError(
        409,
        'ORDER_NOT_COMPLETE',
        'An official report can be issued only when every active ordered test has a current clinically verified result.',
      );
    await db.query(
      `SELECT id FROM lab_reports WHERE organization_id=$1 AND order_id=$2 FOR UPDATE`,
      [principal.organizationId, locked.id],
    );
    const current = (
      await db.query<LabReport & { snapshot: LabReportSnapshot | string }>(
        `SELECT ${reportSelect},r.snapshot
 FROM lab_reports r
 JOIN users iss ON iss.organization_id=r.organization_id AND iss.id=r.issued_by
 WHERE r.organization_id=$1 AND r.order_id=$2 AND r.is_current
 LIMIT 1`,
        [principal.organizationId, locked.id],
      )
    ).rows[0];
    const clinical = await buildReportSnapshot(db, principal, locked.id);
    if (current) {
      const previous =
        typeof current.snapshot === 'string'
          ? (JSON.parse(current.snapshot) as LabReportSnapshot)
          : current.snapshot;
      if (
        JSON.stringify(snapshotResultIds(clinical)) ===
        JSON.stringify(snapshotResultIds(previous))
      )
        throw new ReportError(
          409,
          'REPORT_ALREADY_CURRENT',
          'A current report already exists for these verified results.',
        );
    }
    const nextVersion = current ? Number(current.report_version) + 1 : 1;
    const reportNumber = `${locked.order_number}-R${nextVersion}`;
    const issuedAt = new Date().toISOString();
    const snapshot = attachIssuance(clinical, {
      report_number: reportNumber,
      report_version: nextVersion,
      issued_at: issuedAt,
      issued_by_name: principal.name,
    });
    if (current) {
      await db.query(
        `UPDATE lab_reports SET is_current=false,status='SUPERSEDED',updated_by=$3,version=version+1
 WHERE organization_id=$1 AND id=$2 AND is_current`,
        [principal.organizationId, current.id, principal.userId],
      );
    }
    const inserted = (
      await db.query<{ id: string }>(
        `INSERT INTO lab_reports(
 organization_id,order_id,patient_id,report_number,report_version,issued_at,snapshot,issued_by,
 created_by,updated_by,supersedes_id)
 VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$8,$8,$9)
 RETURNING id`,
        [
          principal.organizationId,
          locked.id,
          locked.patient_id,
          reportNumber,
          nextVersion,
          issuedAt,
          JSON.stringify(snapshot),
          principal.userId,
          current?.id ?? null,
        ],
      )
    ).rows[0];
    if (current) {
      await db.query(
        `UPDATE lab_reports SET successor_id=$3,updated_by=$4
 WHERE organization_id=$1 AND id=$2`,
        [principal.organizationId, current.id, inserted.id, principal.userId],
      );
      await audit(
        db,
        principal,
        'LAB_REPORT',
        current.id,
        'LAB_REPORT_SUPERSEDED',
        {
          order_id: locked.id,
          successor_id: inserted.id,
          from_version: current.report_version,
          to_version: nextVersion,
        },
      );
    }
    await audit(db, principal, 'LAB_REPORT', inserted.id, 'LAB_REPORT_GENERATED', {
      order_id: locked.id,
      report_number: reportNumber,
      report_version: nextVersion,
      supersedes_id: current?.id ?? null,
    });
    return orderWithReports(db, principal, locked.id);
  });
}

export async function downloadReportPdf(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<{ report: LabReport; pdf: Buffer }> {
  permit(principal, 'reports:download');
  const { report, snapshot } = await loadSnapshot(db, principal, id);
  const pdf = await renderReportPdf(snapshot, {
    superseded: report.status === 'SUPERSEDED',
    fallback: {
      report_number: report.report_number,
      report_version: report.report_version,
      issued_at: report.issued_at,
      issued_by_name: report.issued_by_name,
    },
  });
  await audit(db, principal, 'LAB_REPORT', report.id, 'LAB_REPORT_DOWNLOADED', {
    order_id: report.order_id,
    report_version: report.report_version,
  });
  return { report, pdf };
}

export async function recordReportDelivery(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<ReportDelivery> {
  permit(principal, 'reports:deliver');
  permit(principal, 'reports:read');
  const parsed = deliverReportSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    const report = (
      await db.query<{ id: string; order_id: string }>(
        `SELECT id,order_id FROM lab_reports WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!report) notFound();
    const inserted = (
      await db.query<{ id: string }>(
        `INSERT INTO lab_report_deliveries(
 organization_id,report_id,method,recipient_descriptor,notes,status,failure_reason,delivered_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8)
 RETURNING id`,
        [
          principal.organizationId,
          report.id,
          parsed.data.method,
          parsed.data.recipient_descriptor,
          parsed.data.notes,
          parsed.data.status,
          parsed.data.failure_reason,
          principal.userId,
        ],
      )
    ).rows[0];
    await audit(
      db,
      principal,
      'LAB_REPORT',
      report.id,
      'LAB_REPORT_DELIVERED',
      {
        order_id: report.order_id,
        delivery_id: inserted.id,
        method: parsed.data.method,
        status: parsed.data.status,
      },
    );
    return (
      await db.query<ReportDelivery>(
        `SELECT d.id,d.organization_id,d.report_id,d.method,d.recipient_descriptor,d.notes,d.status,
 d.failure_reason,d.delivered_at::text,d.delivered_by,COALESCE(u.name,'') AS delivered_by_name,
 d.created_at::text
 FROM lab_report_deliveries d
 JOIN users u ON u.organization_id=d.organization_id AND u.id=d.delivered_by
 WHERE d.organization_id=$1 AND d.id=$2`,
        [principal.organizationId, inserted.id],
      )
    ).rows[0];
  });
}

export async function listReportWork(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<{
  reports: ReportWorkItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  permit(principal, 'reports:read');
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  const { query, page: requestedPage, pageSize } = parsed.data;
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const where = `r.organization_id=$1 AND ($2='' OR r.report_number ILIKE $3
 OR r.snapshot#>>'{order,order_number}' ILIKE $3
 OR r.snapshot#>>'{patient,first_name}' ILIKE $3
 OR r.snapshot#>>'{patient,last_name}' ILIKE $3
 OR (COALESCE(r.snapshot#>>'{patient,first_name}','') || ' ' ||
  COALESCE(r.snapshot#>>'{patient,last_name}','')) ILIKE $3
 OR r.snapshot#>>'{patient,patient_number}' ILIKE $3)`;
  const values = [principal.organizationId, query, pattern];
  const total = Number(
    (
      await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM lab_reports r WHERE ${where}`,
        values,
      )
    ).rows[0].total,
  );
  const page = Math.min(
    requestedPage,
    Math.max(1, Math.ceil(total / pageSize) || 1),
  );
  const reports = (
    await db.query<ReportWorkItem>(
      `SELECT r.id,r.report_number,r.report_version,r.status,r.issued_at::text,
 COALESCE(r.snapshot#>>'{issuance,issued_by_name}',iss.name,'') AS issued_by_name,
 r.is_current,r.order_id,
 COALESCE(r.snapshot#>>'{order,order_number}','') AS order_number,
 COALESCE(r.snapshot#>>'{order,status}','') AS order_status,
 COALESCE(r.snapshot#>>'{patient,patient_number}','') AS patient_number,
 COALESCE(r.snapshot#>>'{patient,first_name}','') AS patient_first_name,
 COALESCE(r.snapshot#>>'{patient,last_name}','') AS patient_last_name
 FROM lab_reports r
 JOIN users iss ON iss.organization_id=r.organization_id AND iss.id=r.issued_by
 WHERE ${where}
 ORDER BY r.issued_at DESC,r.id
 LIMIT $4 OFFSET $5`,
      [...values, pageSize, (page - 1) * pageSize],
    )
  ).rows.map((row) => ({ ...row, is_current: Boolean(row.is_current) }));
  return { reports, total, page, pageSize };
}

export { listReportsForOrder };
export type { LabReportSnapshot };
