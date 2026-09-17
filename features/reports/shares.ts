import { randomBytes, randomInt } from 'node:crypto';
import type { QueryRunner } from '@/lib/db/query';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import {
  digest,
  dummyPassword,
  hashPassword,
  newSession,
  verifyPassword,
} from '@/lib/auth/password';
import { clinicalReportFromSnapshot } from './clinical';
import { renderReportPdf } from './pdf';
import { mapReport, reportSelect } from './list';
import {
  createShareSchema,
  fieldErrors,
  reportIdSchema,
  shareTokenSchema,
  verifyShareSchema,
} from './validation';
import { shareExpiryLabels } from './format';
import {
  ReportError,
  type CreatedReportShare,
  type LabReport,
  type LabReportShare,
  type LabReportSnapshot,
  type PublicReportView,
  type ShareExpiry,
} from './types';

export const shareCookie = 'medisoft_share';
export const unavailableShareMessage =
  'This report link is unavailable. It may have expired or been revoked.';
const pinLimit = 5;
const pdfLimit = 30;
const windowSql = "now()-interval '15 minutes'";
const shareSelect = `s.id,s.organization_id,s.report_id,r.report_number,r.report_version,r.status AS report_status,
 r.is_current,s.recipient_name,s.recipient_email,s.purpose,s.created_at::text,s.created_by,
 COALESCE(cb.name,'') AS created_by_name,s.expires_at::text,COALESCE(s.revoked_at::text,'') AS revoked_at,
 COALESCE(s.revoked_by::text,'') AS revoked_by,COALESCE(rb.name,'') AS revoked_by_name,
 s.access_count,COALESCE(s.last_accessed_at::text,'') AS last_accessed_at,
 CASE WHEN s.revoked_at IS NOT NULL THEN 'REVOKED'
      WHEN s.expires_at <= now() THEN 'EXPIRED'
      ELSE 'ACTIVE' END AS status`;

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
function unavailable(): never {
  throw new ReportError(404, 'SHARE_UNAVAILABLE', unavailableShareMessage);
}
function mapShare(row: LabReportShare): LabReportShare {
  return {
    ...row,
    report_version: Number(row.report_version),
    is_current: Boolean(row.is_current),
    access_count: Number(row.access_count),
    status: row.status,
  };
}
function expiryHours(expiresIn: ShareExpiry) {
  if (expiresIn === '3d') return 72;
  if (expiresIn === '7d') return 168;
  if (expiresIn === '30d') return 720;
  return 24;
}
function newShareToken() {
  const token = randomBytes(32).toString('hex');
  return { token, digest: digest(token) };
}
function newSharePin() {
  return String(randomInt(0, 100_000_000)).padStart(8, '0');
}
async function audit(
  db: QueryRunner,
  organizationId: string,
  userId: string | null,
  sessionHash: string,
  entityId: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  await db.query(
    `INSERT INTO audit_events(organization_id,user_id,action,entity_type,entity_id,metadata,session_hash)
 VALUES($1,$2,$3,'LAB_REPORT_SHARE',$4,$5::jsonb,$6)`,
    [
      organizationId,
      userId,
      action,
      entityId,
      JSON.stringify(metadata),
      sessionHash,
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
async function consumeLimit(
  db: QueryRunner,
  key: string,
  max: number,
): Promise<boolean> {
  const limit = (
    await db.query<{ attempts: string }>(
      `INSERT INTO share_access_limits(account_hash,attempts) VALUES($1,0)
 ON CONFLICT(account_hash) DO UPDATE SET
 attempts=CASE WHEN share_access_limits.window_start < ${windowSql} THEN 0 ELSE share_access_limits.attempts END,
 window_start=CASE WHEN share_access_limits.window_start < ${windowSql} THEN now() ELSE share_access_limits.window_start END
 RETURNING attempts::text`,
      [key],
    )
  ).rows[0];
  return Number(limit.attempts) < max;
}
async function failLimit(db: QueryRunner, key: string) {
  await db.query(
    `UPDATE share_access_limits SET
 attempts=CASE WHEN window_start < ${windowSql} THEN 1 ELSE attempts+1 END,
 window_start=CASE WHEN window_start < ${windowSql} THEN now() ELSE window_start END
 WHERE account_hash=$1`,
    [key],
  );
}
async function resetLimit(db: QueryRunner, key: string) {
  await db.query(
    'UPDATE share_access_limits SET attempts=0, window_start=now() WHERE account_hash=$1',
    [key],
  );
}
async function loadShareRow(
  db: QueryRunner,
  organizationId: string,
  id: string,
): Promise<LabReportShare> {
  const row = (
    await db.query<LabReportShare>(
      `SELECT ${shareSelect}
 FROM lab_report_shares s
 JOIN lab_reports r ON r.organization_id=s.organization_id AND r.id=s.report_id
 JOIN users cb ON cb.organization_id=s.organization_id AND cb.id=s.created_by
 LEFT JOIN users rb ON rb.organization_id=s.organization_id AND rb.id=s.revoked_by
 WHERE s.organization_id=$1 AND s.id=$2`,
      [organizationId, id],
    )
  ).rows[0];
  return row ? mapShare(row) : notFound('SHARE_NOT_FOUND', 'Share');
}

export async function listReportShares(
  db: QueryRunner,
  principal: Principal,
  reportId: string,
): Promise<LabReportShare[]> {
  permit(principal, 'reports:share');
  const report = (
    await db.query<{ id: string }>(
      `SELECT id FROM lab_reports WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, idValue(reportId)],
    )
  ).rows[0];
  if (!report) notFound();
  return (
    await db.query<LabReportShare>(
      `SELECT ${shareSelect}
 FROM lab_report_shares s
 JOIN lab_reports r ON r.organization_id=s.organization_id AND r.id=s.report_id
 JOIN users cb ON cb.organization_id=s.organization_id AND cb.id=s.created_by
 LEFT JOIN users rb ON rb.organization_id=s.organization_id AND rb.id=s.revoked_by
 WHERE s.organization_id=$1 AND s.report_id=$2
 ORDER BY s.created_at DESC,s.id`,
      [principal.organizationId, report.id],
    )
  ).rows.map(mapShare);
}

export async function createReportShare(
  db: QueryRunner,
  principal: Principal,
  reportId: string,
  input: unknown,
  origin: string,
): Promise<CreatedReportShare> {
  permit(principal, 'reports:share');
  permit(principal, 'reports:read');
  const parsed = createShareSchema.safeParse(input ?? {});
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    const report = (
      await db.query<LabReport>(
        `SELECT ${reportSelect}
 FROM lab_reports r
 JOIN users iss ON iss.organization_id=r.organization_id AND iss.id=r.issued_by
 WHERE r.organization_id=$1 AND r.id=$2
 FOR UPDATE`,
        [principal.organizationId, idValue(reportId)],
      )
    ).rows[0];
    if (!report) notFound();
    const mapped = mapReport(report);
    if (mapped.status !== 'ISSUED' && mapped.status !== 'SUPERSEDED')
      throw new ReportError(
        409,
        'REPORT_NOT_ISSUED',
        'Only an issued official report can be shared.',
      );
    if (mapped.status === 'SUPERSEDED' && !mapped.successor_id)
      throw new ReportError(
        409,
        'REPORT_NOT_CURRENT',
        'This report is no longer current. Issue a replacement before creating a new patient link.',
      );
    const secret = newShareToken();
    const pin = newSharePin();
    const pinHash = await hashPassword(pin);
    const inserted = (
      await db.query<{ id: string }>(
        `INSERT INTO lab_report_shares(
 organization_id,report_id,created_by,expires_at,recipient_name,recipient_email,purpose,token_digest,pin_hash)
 VALUES($1,$2,$3,now() + ($4 * interval '1 hour'),$5,$6,$7,$8,$9)
 RETURNING id`,
        [
          principal.organizationId,
          mapped.id,
          principal.userId,
          expiryHours(parsed.data.expires_in),
          parsed.data.recipient_name,
          parsed.data.recipient_email.toLowerCase(),
          parsed.data.purpose,
          secret.digest,
          pinHash,
        ],
      )
    ).rows[0];
    const share = await loadShareRow(db, principal.organizationId, inserted.id);
    const url = `${origin}/report-access/${secret.token}`;
    const message = [
      `Official laboratory report from ${principal.organizationName}.`,
      `Report ${share.report_number} (version ${share.report_version}).`,
      `Open this secure link: ${url}`,
      `Access PIN: ${pin}`,
      `This link expires ${shareExpiryLabels[parsed.data.expires_in]} after it was created (${share.expires_at}).`,
      'Do not forward the PIN in the same channel as the link if you can avoid it.',
    ].join('\n');
    await audit(
      db,
      principal.organizationId,
      principal.userId,
      principal.sessionHash,
      share.id,
      'LAB_REPORT_SHARE_CREATED',
      {
        order_id: mapped.order_id,
        report_id: mapped.id,
        report_number: mapped.report_number,
        report_version: mapped.report_version,
        expires_at: share.expires_at,
        recipient_name: share.recipient_name,
        recipient_email: share.recipient_email,
      },
    );
    return { share, token: secret.token, pin, url, message };
  });
}

export async function revokeReportShare(
  db: QueryRunner,
  principal: Principal,
  shareId: string,
): Promise<LabReportShare> {
  permit(principal, 'reports:share-revoke');
  return transaction(db, async () => {
    const locked = (
      await db.query<{
        id: string;
        report_id: string;
        report_number: string;
        report_version: string;
        order_id: string;
        revoked_at: string;
      }>(
        `SELECT s.id,s.report_id,r.report_number,r.report_version::text,r.order_id,
 COALESCE(s.revoked_at::text,'') AS revoked_at
 FROM lab_report_shares s
 JOIN lab_reports r ON r.organization_id=s.organization_id AND r.id=s.report_id
 WHERE s.organization_id=$1 AND s.id=$2
 FOR UPDATE`,
        [principal.organizationId, idValue(shareId, 'SHARE_NOT_FOUND', 'Share')],
      )
    ).rows[0];
    if (!locked) notFound('SHARE_NOT_FOUND', 'Share');
    if (locked.revoked_at)
      throw new ReportError(
        409,
        'SHARE_ALREADY_REVOKED',
        'This share has already been revoked.',
      );
    await db.query(
      `UPDATE lab_report_shares SET revoked_at=now(),revoked_by=$3
 WHERE organization_id=$1 AND id=$2 AND revoked_at IS NULL`,
      [principal.organizationId, locked.id, principal.userId],
    );
    await db.query(
      'DELETE FROM lab_report_share_sessions WHERE organization_id=$1 AND share_id=$2',
      [principal.organizationId, locked.id],
    );
    await audit(
      db,
      principal.organizationId,
      principal.userId,
      principal.sessionHash,
      locked.id,
      'LAB_REPORT_SHARE_REVOKED',
      {
        order_id: locked.order_id,
        report_id: locked.report_id,
        report_number: locked.report_number,
        report_version: Number(locked.report_version),
      },
    );
    return loadShareRow(db, principal.organizationId, locked.id);
  });
}

type PublicShareRow = {
  id: string;
  organization_id: string;
  report_id: string;
  report_number: string;
  report_version: string;
  report_status: string;
  issued_at: string;
  issued_by_name: string;
  order_id: string;
  snapshot: LabReportSnapshot | string;
  pin_hash: string;
  expires_at: string;
  revoked_at: string;
};

async function loadPublicShare(
  db: QueryRunner,
  token: string,
): Promise<PublicShareRow | null> {
  if (!shareTokenSchema.safeParse(token).success) return null;
  const row = (
    await db.query<PublicShareRow>(
      `SELECT s.id,s.organization_id,s.report_id,r.report_number,r.report_version::text,r.status AS report_status,
 r.issued_at::text,COALESCE(r.snapshot#>>'{issuance,issued_by_name}',iss.name,'') AS issued_by_name,
 r.order_id,r.snapshot,s.pin_hash,s.expires_at::text,COALESCE(s.revoked_at::text,'') AS revoked_at
 FROM lab_report_shares s
 JOIN lab_reports r ON r.organization_id=s.organization_id AND r.id=s.report_id
 JOIN users iss ON iss.organization_id=r.organization_id AND iss.id=r.issued_by
 WHERE s.token_digest=$1`,
      [digest(token)],
    )
  ).rows[0];
  return row ?? null;
}
function shareIsActive(row: PublicShareRow) {
  return !row.revoked_at && new Date(row.expires_at).getTime() > Date.now();
}
function parseSnapshot(value: LabReportSnapshot | string): LabReportSnapshot {
  return typeof value === 'string'
    ? (JSON.parse(value) as LabReportSnapshot)
    : value;
}
function publicView(row: PublicShareRow): PublicReportView {
  const snapshot = parseSnapshot(row.snapshot);
  const clinical = clinicalReportFromSnapshot(snapshot, {
    report_number: row.report_number,
    report_version: Number(row.report_version),
    issued_at: row.issued_at,
    issued_by_name: row.issued_by_name,
    superseded: row.report_status === 'SUPERSEDED',
  });
  return {
    organization_name: clinical.organization.name,
    organization_address: clinical.organization.address,
    organization_phone: clinical.organization.phone,
    organization_email: clinical.organization.email,
    report_number: clinical.issuance.report_number,
    report_version: clinical.issuance.report_version,
    issued_at: clinical.issuance.issued_at,
    issued_by_name: clinical.issuance.issued_by_name,
    patient_name:
      `${clinical.patient.first_name} ${clinical.patient.last_name}`.trim(),
    patient_number: clinical.patient.patient_number,
    order_number: clinical.order.order_number,
    status: row.report_status,
    superseded: clinical.issuance.superseded,
  };
}
async function sessionMatchesShare(
  db: QueryRunner,
  share: PublicShareRow,
  sessionToken: string | undefined,
) {
  if (!sessionToken || !/^[a-f0-9]{64}$/.test(sessionToken)) return false;
  const row = (
    await db.query<{ id: string }>(
      `SELECT s.share_id AS id FROM lab_report_share_sessions s
 WHERE s.token_hash=$1 AND s.organization_id=$2 AND s.share_id=$3 AND s.expires_at > now()`,
      [digest(sessionToken), share.organization_id, share.id],
    )
  ).rows[0];
  return Boolean(row);
}
async function touchShare(
  db: QueryRunner,
  share: PublicShareRow,
  action: 'LAB_REPORT_SHARE_ACCESSED' | 'LAB_REPORT_SHARE_DOWNLOAD',
  sessionHash: string,
) {
  await db.query(
    `UPDATE lab_report_shares SET access_count=access_count+1,last_accessed_at=now()
 WHERE organization_id=$1 AND id=$2`,
    [share.organization_id, share.id],
  );
  await audit(db, share.organization_id, null, sessionHash, share.id, action, {
    order_id: share.order_id,
    report_id: share.report_id,
    report_number: share.report_number,
    report_version: Number(share.report_version),
  });
}

export async function inspectPublicShare(
  db: QueryRunner,
  token: string,
  sessionToken?: string,
): Promise<{
  status: 'unavailable' | 'verify' | 'ready';
  view?: PublicReportView;
}> {
  const share = await loadPublicShare(db, token);
  if (!share || !shareIsActive(share)) return { status: 'unavailable' };
  if (await sessionMatchesShare(db, share, sessionToken))
    return { status: 'ready', view: publicView(share) };
  return { status: 'verify' };
}

export async function verifyPublicShare(
  db: QueryRunner,
  token: string,
  input: unknown,
): Promise<{ sessionToken: string; expiresAt: Date; view: PublicReportView }> {
  const parsed = verifyShareSchema.safeParse(input ?? {});
  if (!parsed.success) invalid(parsed.error);
  const limitKey = digest(`pin:${token}`);
  if (!(await consumeLimit(db, limitKey, pinLimit)))
    throw new ReportError(
      429,
      'SHARE_RATE_LIMITED',
      'Too many attempts. Please try again later.',
    );
  const share = await loadPublicShare(db, token);
  if (!share || !shareIsActive(share)) {
    await verifyPassword(parsed.data.pin, dummyPassword);
    await failLimit(db, limitKey);
    unavailable();
  }
  const correct = await verifyPassword(parsed.data.pin, share.pin_hash);
  if (!correct) {
    await failLimit(db, limitKey);
    throw new ReportError(
      401,
      'SHARE_PIN_INVALID',
      'The access PIN is incorrect.',
    );
  }
  await resetLimit(db, limitKey);
  const session = newSession();
  const remainingMs = new Date(share.expires_at).getTime() - Date.now();
  const ttlMs = Math.max(60_000, Math.min(2 * 60 * 60 * 1000, remainingMs));
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.query(
    `INSERT INTO lab_report_share_sessions(token_hash,organization_id,share_id,expires_at)
 VALUES($1,$2,$3,$4)`,
    [session.hash, share.organization_id, share.id, expiresAt.toISOString()],
  );
  await audit(
    db,
    share.organization_id,
    null,
    session.hash,
    share.id,
    'LAB_REPORT_SHARE_VERIFIED',
    {
      order_id: share.order_id,
      report_id: share.report_id,
      report_number: share.report_number,
      report_version: Number(share.report_version),
    },
  );
  await touchShare(db, share, 'LAB_REPORT_SHARE_ACCESSED', session.hash);
  return { sessionToken: session.token, expiresAt, view: publicView(share) };
}

export async function downloadPublicSharePdf(
  db: QueryRunner,
  token: string,
  sessionToken: string | undefined,
): Promise<{ pdf: Buffer; filename: string; view: PublicReportView }> {
  const limitKey = digest(`pdf:${token}`);
  if (!(await consumeLimit(db, limitKey, pdfLimit)))
    throw new ReportError(
      429,
      'SHARE_RATE_LIMITED',
      'Too many attempts. Please try again later.',
    );
  const share = await loadPublicShare(db, token);
  if (!share || !shareIsActive(share)) {
    await failLimit(db, limitKey);
    unavailable();
  }
  if (!(await sessionMatchesShare(db, share, sessionToken))) {
    await failLimit(db, limitKey);
    unavailable();
  }
  const snapshot = parseSnapshot(share.snapshot);
  await failLimit(db, limitKey);
  const pdf = await renderReportPdf(snapshot, {
    superseded: share.report_status === 'SUPERSEDED',
    fallback: {
      report_number: share.report_number,
      report_version: Number(share.report_version),
      issued_at: share.issued_at,
      issued_by_name: share.issued_by_name,
    },
  });
  await touchShare(
    db,
    share,
    'LAB_REPORT_SHARE_DOWNLOAD',
    digest(sessionToken as string),
  );
  return {
    pdf,
    filename: `${share.report_number}.pdf`,
    view: publicView(share),
  };
}

export { digest as shareTokenDigest };
