import type { QueryRunner } from '@/lib/db/query';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import { getOrder } from '@/features/orders/repository';
import { evaluateOrderCompletion } from '@/features/reports/completion';
import { OrderError, type LabOrder } from '@/features/orders/types';
import { calculateNumericFlag } from './flags';
import { selectReferenceRange, type SelectableRange } from './ranges';
import {
  amendResultSchema,
  enterResultSchema,
  fieldErrors,
  resultIdSchema,
  versionSchema,
  worklistSchema,
} from './validation';
import {
  ResultError,
  type LabResult,
  type ResultContext,
  type ResultWorkItem,
} from './types';

const resultSelect = `r.id,r.organization_id,r.order_id,r.order_test_id,r.status,r.result_type_snapshot,
 COALESCE(r.numeric_value::text,'') AS numeric_value,r.text_value,
 COALESCE(r.boolean_value::text,'') AS boolean_value,r.unit_symbol_snapshot,r.method_snapshot,r.flag,
 COALESCE(r.reference_range_id::text,'') AS reference_range_id,
 COALESCE(r.range_version_snapshot::text,'') AS range_version_snapshot,r.range_sex_snapshot,
 COALESCE(r.range_lower_snapshot::text,'') AS range_lower_snapshot,
 COALESCE(r.range_upper_snapshot::text,'') AS range_upper_snapshot,
 r.range_lower_operator_snapshot,r.range_upper_operator_snapshot,r.range_text_snapshot,
 r.range_unit_symbol_snapshot,r.range_method_snapshot,
 COALESCE(r.critical_low_snapshot::text,'') AS critical_low_snapshot,
 COALESCE(r.critical_high_snapshot::text,'') AS critical_high_snapshot,
 r.entered_at::text,r.entered_by,COALESCE(ent.name,'') AS entered_by_name,
 COALESCE(r.technically_validated_at::text,'') AS technically_validated_at,
 COALESCE(r.technically_validated_by::text,'') AS technically_validated_by,
 COALESCE(val.name,'') AS technically_validated_by_name,
 COALESCE(r.clinically_verified_at::text,'') AS clinically_verified_at,
 COALESCE(r.clinically_verified_by::text,'') AS clinically_verified_by,
 COALESCE(ver.name,'') AS clinically_verified_by_name,r.amendment_reason,
 COALESCE(r.supersedes_id::text,'') AS supersedes_id,
 COALESCE(r.successor_id::text,'') AS successor_id,r.is_current,r.version,
 r.created_at::text,r.created_by,r.updated_at::text,r.updated_by`;

function permit(principal: Principal, permission: Permission) {
  if (!principal.organizationId || !can(principal.role, permission))
    throw new ResultError(
      403,
      'FORBIDDEN',
      'Your role does not allow this action.',
    );
}
function idValue(id: string, code = 'RESULT_NOT_FOUND', label = 'Result') {
  if (!resultIdSchema.safeParse(id).success)
    throw new ResultError(404, code, `${label} not found.`);
  return id;
}
function notFound(code = 'RESULT_NOT_FOUND', label = 'Result'): never {
  throw new ResultError(404, code, `${label} not found.`);
}
function invalid(error: Parameters<typeof fieldErrors>[0]): never {
  throw new ResultError(
    400,
    'VALIDATION',
    'Check the highlighted fields.',
    fieldErrors(error),
  );
}
function stale(): never {
  throw new ResultError(
    409,
    'STALE_VERSION',
    'This record was updated by another user. Refresh and try again.',
  );
}
function asOrderError(error: unknown): never {
  if (error instanceof OrderError)
    throw new ResultError(error.status, error.code, error.message, error.fields);
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
function blank(value: string) {
  return value === '' ? null : value;
}
function mapResult(row: LabResult): LabResult {
  return { ...row, is_current: Boolean(row.is_current) };
}

export async function listResultsForOrder(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
): Promise<LabResult[]> {
  if (!can(principal.role, 'results:read')) return [];
  return (
    await db.query<LabResult>(
      `SELECT ${resultSelect}
 FROM lab_results r
 JOIN users ent ON ent.organization_id=r.organization_id AND ent.id=r.entered_by
 LEFT JOIN users val ON val.organization_id=r.organization_id AND val.id=r.technically_validated_by
 LEFT JOIN users ver ON ver.organization_id=r.organization_id AND ver.id=r.clinically_verified_by
 WHERE r.organization_id=$1 AND r.order_id=$2
 ORDER BY r.created_at,r.id`,
      [principal.organizationId, orderId],
    )
  ).rows.map(mapResult);
}

async function loadResult(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<LabResult> {
  const row = (
    await db.query<LabResult>(
      `SELECT ${resultSelect}
 FROM lab_results r
 JOIN users ent ON ent.organization_id=r.organization_id AND ent.id=r.entered_by
 LEFT JOIN users val ON val.organization_id=r.organization_id AND val.id=r.technically_validated_by
 LEFT JOIN users ver ON ver.organization_id=r.organization_id AND ver.id=r.clinically_verified_by
 WHERE r.organization_id=$1 AND r.id=$2`,
      [principal.organizationId, idValue(id)],
    )
  ).rows[0];
  return row ? mapResult(row) : notFound();
}

async function orderWithResults(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
): Promise<LabOrder> {
  try {
    const order = await getOrder(db, principal, orderId);
    order.results = await listResultsForOrder(db, principal, order.id);
    return order;
  } catch (error) {
    asOrderError(error);
  }
}

type RangeRow = SelectableRange & {
  lower_bound: string;
  upper_bound: string;
  lower_operator: string;
  upper_operator: string;
  text_range: string;
  critical_low: string;
  critical_high: string;
  range_version: string;
};

async function loadCandidateRanges(
  db: QueryRunner,
  principal: Principal,
  testId: string,
): Promise<RangeRow[]> {
  return (
    await db.query<RangeRow>(
      `SELECT r.id,r.sex,COALESCE(r.age_min::text,'') AS age_min,COALESCE(r.age_max::text,'') AS age_max,
 r.age_unit,r.method,COALESCE(u.symbol,'') AS unit_symbol,r.is_active,r.valid_from::text,
 COALESCE(r.valid_to::text,'') AS valid_to,COALESCE(r.lower_bound::text,'') AS lower_bound,
 COALESCE(r.upper_bound::text,'') AS upper_bound,r.lower_operator,r.upper_operator,r.text_range,
 COALESCE(r.critical_low::text,'') AS critical_low,COALESCE(r.critical_high::text,'') AS critical_high,
 r.range_version::text
 FROM lab_reference_ranges r
 LEFT JOIN lab_units u ON u.organization_id=r.organization_id AND u.id=r.unit_id
 WHERE r.organization_id=$1 AND r.test_id=$2`,
      [principal.organizationId, testId],
    )
  ).rows.map((row) => ({ ...row, is_active: Boolean(row.is_active) }));
}

function snapshotFromRange(range: RangeRow | null) {
  if (!range)
    return {
      reference_range_id: null as string | null,
      range_version_snapshot: null as string | null,
      range_sex_snapshot: '',
      range_lower_snapshot: null as string | null,
      range_upper_snapshot: null as string | null,
      range_lower_operator_snapshot: '',
      range_upper_operator_snapshot: '',
      range_text_snapshot: '',
      range_unit_symbol_snapshot: '',
      range_method_snapshot: '',
      critical_low_snapshot: null as string | null,
      critical_high_snapshot: null as string | null,
    };
  return {
    reference_range_id: range.id,
    range_version_snapshot: range.range_version,
    range_sex_snapshot: range.sex,
    range_lower_snapshot: blank(range.lower_bound),
    range_upper_snapshot: blank(range.upper_bound),
    range_lower_operator_snapshot: range.lower_operator,
    range_upper_operator_snapshot: range.upper_operator,
    range_text_snapshot: range.text_range,
    range_unit_symbol_snapshot: range.unit_symbol,
    range_method_snapshot: range.method,
    critical_low_snapshot: blank(range.critical_low),
    critical_high_snapshot: blank(range.critical_high),
  };
}

function interpret(
  resultType: string,
  numericValue: string,
  range: RangeRow | null,
) {
  if (resultType !== 'NUMERIC') return 'UNINTERPRETED';
  return calculateNumericFlag(Number(numericValue), range);
}

function parsedValues(
  resultType: string,
  input: {
    numeric_value?: string;
    text_value?: string;
    boolean_value?: boolean;
  },
) {
  if (resultType === 'NUMERIC') {
    if (!input.numeric_value)
      throw new ResultError(400, 'VALIDATION', 'Enter a numeric result.', {
        numeric_value: 'A numeric value is required.',
      });
    return {
      numeric_value: input.numeric_value,
      text_value: '',
      boolean_value: null as boolean | null,
    };
  }
  if (resultType === 'BOOLEAN') {
    if (typeof input.boolean_value !== 'boolean')
      throw new ResultError(400, 'VALIDATION', 'Enter a boolean result.', {
        boolean_value: 'Select a boolean result.',
      });
    return {
      numeric_value: null as string | null,
      text_value: '',
      boolean_value: input.boolean_value,
    };
  }
  if (!input.text_value)
    throw new ResultError(400, 'VALIDATION', 'Enter a result value.', {
      text_value: 'A result value is required.',
    });
  return {
    numeric_value: null as string | null,
    text_value: input.text_value,
    boolean_value: null as boolean | null,
  };
}

async function requireEligibleTest(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
  orderTestId: string,
  orderVersion: number,
) {
  let order;
  try {
    order = await getOrder(db, principal, orderId);
  } catch (error) {
    asOrderError(error);
  }
  if (Number(order.version) !== orderVersion) stale();
  if (
    order.status !== 'RECEIVED' &&
    order.status !== 'IN_PROCESS' &&
    order.status !== 'COMPLETED'
  )
    throw new ResultError(
      409,
      'INVALID_ORDER_STATUS',
      'Results can be entered after specimens have been received.',
    );
  const test = order.tests.find((row) => row.id === orderTestId);
  if (!test) notFound('ORDER_TEST_NOT_FOUND', 'Ordered test');
  if (test.status !== 'ACTIVE')
    throw new ResultError(
      409,
      'INVALID_ORDER_STATUS',
      'Cancelled ordered tests cannot receive results.',
    );
  if (test.covering_status !== 'RECEIVED')
    throw new ResultError(
      409,
      'SPECIMEN_NOT_READY',
      'A received specimen must cover this test before a result can be entered.',
    );
  return { order, test };
}

export async function getResultContext(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
  orderTestId: string,
): Promise<ResultContext> {
  permit(principal, 'results:read');
  idValue(orderTestId, 'ORDER_TEST_NOT_FOUND', 'Ordered test');
  let order: LabOrder;
  try {
    order = await getOrder(db, principal, orderId);
  } catch (error) {
    asOrderError(error);
  }
  const test = order.tests.find((row) => row.id === orderTestId);
  if (!test) notFound('ORDER_TEST_NOT_FOUND', 'Ordered test');
  const current =
    (await listResultsForOrder(db, principal, order.id)).find(
      (row) => row.order_test_id === test.id && row.is_current,
    ) ?? null;
  const ranges = await loadCandidateRanges(db, principal, test.lab_test_id);
  const patient = (
    await db.query<{ sex: string; date_of_birth: string }>(
      `SELECT sex,COALESCE(date_of_birth::text,'') AS date_of_birth
 FROM patients WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, order.patient_id],
    )
  ).rows[0] ?? { sex: 'UNKNOWN', date_of_birth: '' };
  const selected = selectReferenceRange(
    ranges,
    patient,
    test.method_snapshot,
    test.unit_symbol_snapshot,
  );
  const range = selected
    ? ranges.find((row) => row.id === selected.id) ?? null
    : null;
  return {
    order_id: order.id,
    order_test_id: test.id,
    order_status: order.status,
    order_version: Number(order.version),
    code: test.code_snapshot,
    name: test.name_snapshot,
    result_type: test.result_type_snapshot,
    unit_symbol: test.unit_symbol_snapshot,
    method: test.method_snapshot,
    covering_status: test.covering_status,
    current,
    range: range
      ? {
          id: range.id,
          sex: range.sex,
          age_min: range.age_min,
          age_max: range.age_max,
          age_unit: range.age_unit,
          lower_bound: range.lower_bound,
          upper_bound: range.upper_bound,
          lower_operator: range.lower_operator,
          upper_operator: range.upper_operator,
          text_range: range.text_range,
          unit_symbol: range.unit_symbol,
          method: range.method,
          critical_low: range.critical_low,
          critical_high: range.critical_high,
          range_version: range.range_version,
        }
      : null,
    range_reason: range
      ? ''
      : 'No applicable active reference range was selected.',
  };
}

async function writeEnteredResult(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
  orderTestId: string,
  input: {
    numeric_value?: string;
    text_value?: string;
    boolean_value?: boolean;
  },
  amendment?: { supersedesId: string; reason: string },
) {
  const locked = (
    await db.query<{ id: string; status: string; version: number }>(
      `SELECT id,status,version FROM lab_orders
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [principal.organizationId, orderId],
    )
  ).rows[0];
  if (!locked) notFound('ORDER_NOT_FOUND', 'Order');
  if (
    locked.status !== 'RECEIVED' &&
    locked.status !== 'IN_PROCESS' &&
    locked.status !== 'COMPLETED'
  )
    throw new ResultError(
      409,
      'INVALID_ORDER_STATUS',
      'Results can be entered after specimens have been received.',
    );
  let order;
  try {
    order = await getOrder(db, principal, orderId);
  } catch (error) {
    asOrderError(error);
  }
  const test = order.tests.find((row) => row.id === orderTestId);
  if (!test) notFound('ORDER_TEST_NOT_FOUND', 'Ordered test');
  const values = parsedValues(test.result_type_snapshot, input);
  const patient = (
    await db.query<{ sex: string; date_of_birth: string }>(
      `SELECT sex,COALESCE(date_of_birth::text,'') AS date_of_birth
 FROM patients WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, order.patient_id],
    )
  ).rows[0];
  const ranges = await loadCandidateRanges(db, principal, test.lab_test_id);
  const selected = selectReferenceRange(
    ranges,
    patient ?? { sex: 'UNKNOWN', date_of_birth: '' },
    test.method_snapshot,
    test.unit_symbol_snapshot,
  );
  const range = selected
    ? ranges.find((row) => row.id === selected.id) ?? null
    : null;
  const snapshot = snapshotFromRange(range);
  const flag = interpret(
    test.result_type_snapshot,
    values.numeric_value ?? '',
    range,
  );
  if (locked.status === 'RECEIVED') {
    await db.query(
      `UPDATE lab_orders SET status='IN_PROCESS',updated_by=$3,version=version+1
 WHERE organization_id=$1 AND id=$2 AND status='RECEIVED'`,
      [principal.organizationId, orderId, principal.userId],
    );
    await audit(db, principal, 'LAB_ORDER', orderId, 'LAB_ORDER_IN_PROCESS', {
      from: 'RECEIVED',
      to: 'IN_PROCESS',
    });
  }
  const inserted = (
    await db.query<{ id: string }>(
      `INSERT INTO lab_results(
 organization_id,order_id,order_test_id,result_type_snapshot,numeric_value,text_value,boolean_value,
 unit_symbol_snapshot,method_snapshot,flag,reference_range_id,range_version_snapshot,range_sex_snapshot,
 range_lower_snapshot,range_upper_snapshot,range_lower_operator_snapshot,range_upper_operator_snapshot,
 range_text_snapshot,range_unit_symbol_snapshot,range_method_snapshot,critical_low_snapshot,
 critical_high_snapshot,entered_by,created_by,updated_by,amendment_reason,supersedes_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23,$23,$24,$25)
 RETURNING id`,
      [
        principal.organizationId,
        orderId,
        test.id,
        test.result_type_snapshot,
        values.numeric_value,
        values.text_value,
        values.boolean_value,
        test.unit_symbol_snapshot,
        test.method_snapshot,
        flag,
        snapshot.reference_range_id,
        snapshot.range_version_snapshot,
        snapshot.range_sex_snapshot,
        snapshot.range_lower_snapshot,
        snapshot.range_upper_snapshot,
        snapshot.range_lower_operator_snapshot,
        snapshot.range_upper_operator_snapshot,
        snapshot.range_text_snapshot,
        snapshot.range_unit_symbol_snapshot,
        snapshot.range_method_snapshot,
        snapshot.critical_low_snapshot,
        snapshot.critical_high_snapshot,
        principal.userId,
        amendment?.reason ?? '',
        amendment?.supersedesId ?? null,
      ],
    )
  ).rows[0];
  return inserted.id;
}

export async function enterResult(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
  orderTestId: string,
  input: unknown,
): Promise<LabOrder> {
  permit(principal, 'results:enter');
  permit(principal, 'results:read');
  const parsed = enterResultSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  idValue(orderTestId, 'ORDER_TEST_NOT_FOUND', 'Ordered test');
  return transaction(db, async () => {
    const { order, test } = await requireEligibleTest(
      db,
      principal,
      orderId,
      orderTestId,
      parsed.data.version,
    );
    const current = (
      await db.query<{ id: string; status: string; version: number }>(
        `SELECT id,status,version FROM lab_results
 WHERE organization_id=$1 AND order_test_id=$2 AND is_current FOR UPDATE`,
        [principal.organizationId, test.id],
      )
    ).rows[0];
    if (current && current.status !== 'ENTERED')
      throw new ResultError(
        409,
        'INVALID_RESULT_STATUS',
        current.status === 'CLINICALLY_VERIFIED'
          ? 'Verified results must be amended, not overwritten.'
          : 'This result can no longer be edited. Complete verification or amend a verified result.',
      );
    if (current) {
      const values = parsedValues(test.result_type_snapshot, parsed.data);
      const patient = (
        await db.query<{ sex: string; date_of_birth: string }>(
          `SELECT sex,COALESCE(date_of_birth::text,'') AS date_of_birth
 FROM patients WHERE organization_id=$1 AND id=$2`,
          [principal.organizationId, order.patient_id],
        )
      ).rows[0];
      const ranges = await loadCandidateRanges(db, principal, test.lab_test_id);
      const selected = selectReferenceRange(
        ranges,
        patient ?? { sex: 'UNKNOWN', date_of_birth: '' },
        test.method_snapshot,
        test.unit_symbol_snapshot,
      );
      const range = selected
        ? ranges.find((row) => row.id === selected.id) ?? null
        : null;
      const snapshot = snapshotFromRange(range);
      const flag = interpret(
        test.result_type_snapshot,
        values.numeric_value ?? '',
        range,
      );
      const updated = await db.query<{ id: string }>(
        `UPDATE lab_results SET numeric_value=$3,text_value=$4,boolean_value=$5,unit_symbol_snapshot=$6,
 method_snapshot=$7,flag=$8,reference_range_id=$9,range_version_snapshot=$10,range_sex_snapshot=$11,
 range_lower_snapshot=$12,range_upper_snapshot=$13,range_lower_operator_snapshot=$14,
 range_upper_operator_snapshot=$15,range_text_snapshot=$16,range_unit_symbol_snapshot=$17,
 range_method_snapshot=$18,critical_low_snapshot=$19,critical_high_snapshot=$20,entered_at=now(),
 entered_by=$21,updated_by=$21,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$22 AND status='ENTERED'
 RETURNING id`,
        [
          principal.organizationId,
          current.id,
          values.numeric_value,
          values.text_value,
          values.boolean_value,
          test.unit_symbol_snapshot,
          test.method_snapshot,
          flag,
          snapshot.reference_range_id,
          snapshot.range_version_snapshot,
          snapshot.range_sex_snapshot,
          snapshot.range_lower_snapshot,
          snapshot.range_upper_snapshot,
          snapshot.range_lower_operator_snapshot,
          snapshot.range_upper_operator_snapshot,
          snapshot.range_text_snapshot,
          snapshot.range_unit_symbol_snapshot,
          snapshot.range_method_snapshot,
          snapshot.critical_low_snapshot,
          snapshot.critical_high_snapshot,
          principal.userId,
          Number(current.version),
        ],
      );
      if (!updated.rows[0]) stale();
      await audit(db, principal, 'LAB_RESULT', current.id, 'RESULT_UPDATED', {
        order_id: order.id,
        order_test_id: test.id,
        flag,
      });
    } else {
      const id = await writeEnteredResult(
        db,
        principal,
        order.id,
        test.id,
        parsed.data,
      );
      await audit(db, principal, 'LAB_RESULT', id, 'RESULT_ENTERED', {
        order_id: order.id,
        order_test_id: test.id,
      });
    }
    return orderWithResults(db, principal, order.id);
  });
}

export async function validateResult(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<LabOrder> {
  permit(principal, 'results:validate');
  permit(principal, 'results:read');
  const parsed = versionSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    const result = (
      await db.query<{
        id: string;
        order_id: string;
        status: string;
        version: number;
      }>(
        `SELECT id,order_id,status,version FROM lab_results
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!result) notFound();
    if (Number(result.version) !== parsed.data.version) stale();
    if (result.status !== 'ENTERED')
      throw new ResultError(
        409,
        'INVALID_RESULT_TRANSITION',
        'Only entered results can be technically validated.',
      );
    const validated = (
      await db.query<{ id: string }>(
        `UPDATE lab_results SET status='TECHNICALLY_VALIDATED',technically_validated_at=now(),
 technically_validated_by=$3,updated_by=$3,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$4 AND status='ENTERED'
 RETURNING id`,
        [
          principal.organizationId,
          result.id,
          principal.userId,
          Number(result.version),
        ],
      )
    ).rows[0];
    if (!validated) stale();
    await audit(
      db,
      principal,
      'LAB_RESULT',
      result.id,
      'RESULT_TECHNICALLY_VALIDATED',
      { order_id: result.order_id, from: 'ENTERED', to: 'TECHNICALLY_VALIDATED' },
    );
    return orderWithResults(db, principal, result.order_id);
  });
}

export async function verifyResult(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<LabOrder> {
  permit(principal, 'results:verify');
  permit(principal, 'results:read');
  const parsed = versionSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    const result = (
      await db.query<{
        id: string;
        order_id: string;
        status: string;
        version: number;
      }>(
        `SELECT id,order_id,status,version FROM lab_results
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!result) notFound();
    if (Number(result.version) !== parsed.data.version) stale();
    if (result.status !== 'TECHNICALLY_VALIDATED')
      throw new ResultError(
        409,
        'INVALID_RESULT_TRANSITION',
        'Only technically validated results can be clinically verified.',
      );
    const verified = (
      await db.query<{ id: string }>(
        `UPDATE lab_results SET status='CLINICALLY_VERIFIED',clinically_verified_at=now(),
 clinically_verified_by=$3,updated_by=$3,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$4 AND status='TECHNICALLY_VALIDATED'
 RETURNING id`,
        [
          principal.organizationId,
          result.id,
          principal.userId,
          Number(result.version),
        ],
      )
    ).rows[0];
    if (!verified) stale();
    await audit(
      db,
      principal,
      'LAB_RESULT',
      result.id,
      'RESULT_CLINICALLY_VERIFIED',
      {
        order_id: result.order_id,
        from: 'TECHNICALLY_VALIDATED',
        to: 'CLINICALLY_VERIFIED',
      },
    );
    await evaluateOrderCompletion(db, principal, result.order_id);
    return orderWithResults(db, principal, result.order_id);
  });
}

export async function amendResult(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<LabOrder> {
  permit(principal, 'results:amend');
  permit(principal, 'results:read');
  const parsed = amendResultSchema.safeParse(input);
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    if (errors.reason)
      throw new ResultError(
        400,
        'AMENDMENT_REASON_REQUIRED',
        'Amendment reason is required.',
        errors,
      );
    invalid(parsed.error);
  }
  return transaction(db, async () => {
    const current = (
      await db.query<{
        id: string;
        order_id: string;
        order_test_id: string;
        status: string;
        version: number;
        is_current: boolean;
      }>(
        `SELECT id,order_id,order_test_id,status,version,is_current FROM lab_results
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!current) notFound();
    if (Number(current.version) !== parsed.data.version) stale();
    if (!current.is_current || current.status !== 'CLINICALLY_VERIFIED')
      throw new ResultError(
        409,
        'INVALID_RESULT_STATUS',
        'Only the current clinically verified result can be amended.',
      );
    const order = (
      await db.query<{ status: string }>(
        `SELECT status FROM lab_orders WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, current.order_id],
      )
    ).rows[0];
    if (
      !order ||
      (order.status !== 'IN_PROCESS' &&
        order.status !== 'RECEIVED' &&
        order.status !== 'COMPLETED')
    )
      throw new ResultError(
        409,
        'INVALID_ORDER_STATUS',
        'This order cannot accept an amended result.',
      );
    await db.query(
      `UPDATE lab_results SET is_current=false,status='SUPERSEDED',updated_by=$3,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$4 AND status='CLINICALLY_VERIFIED'`,
      [
        principal.organizationId,
        current.id,
        principal.userId,
        Number(current.version),
      ],
    );
    const nextId = await writeEnteredResult(
      db,
      principal,
      current.order_id,
      current.order_test_id,
      parsed.data,
      { supersedesId: current.id, reason: parsed.data.reason },
    );
    await db.query(
      `UPDATE lab_results SET successor_id=$3,updated_by=$4
 WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, current.id, nextId, principal.userId],
    );
    await audit(db, principal, 'LAB_RESULT', nextId, 'RESULT_AMENDED', {
      order_id: current.order_id,
      order_test_id: current.order_test_id,
      supersedes_id: current.id,
      reason: parsed.data.reason,
    });
    await evaluateOrderCompletion(db, principal, current.order_id);
    return orderWithResults(db, principal, current.order_id);
  });
}

export async function listResultHistory(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<LabResult[]> {
  permit(principal, 'results:read');
  const result = await loadResult(db, principal, id);
  return (
    await db.query<LabResult>(
      `SELECT ${resultSelect}
 FROM lab_results r
 JOIN users ent ON ent.organization_id=r.organization_id AND ent.id=r.entered_by
 LEFT JOIN users val ON val.organization_id=r.organization_id AND val.id=r.technically_validated_by
 LEFT JOIN users ver ON ver.organization_id=r.organization_id AND ver.id=r.clinically_verified_by
 WHERE r.organization_id=$1 AND r.order_test_id=$2
 ORDER BY r.created_at,r.id`,
      [principal.organizationId, result.order_test_id],
    )
  ).rows.map(mapResult);
}

export async function listResultWork(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<{ orders: ResultWorkItem[]; total: number; page: number; pageSize: number }> {
  permit(principal, 'results:read');
  const parsed = worklistSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  const { query, page: requestedPage, pageSize } = parsed.data;
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const where = `o.organization_id=$1 AND o.status IN ('RECEIVED','IN_PROCESS')
 AND ($2='' OR o.order_number ILIKE $3 OR p.first_name ILIKE $3 OR p.last_name ILIKE $3
  OR (p.first_name || ' ' || p.last_name) ILIKE $3 OR p.patient_number ILIKE $3)`;
  const values = [principal.organizationId, query, pattern];
  const total = Number(
    (
      await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM lab_orders o
 JOIN patients p ON p.organization_id=o.organization_id AND p.id=o.patient_id
 WHERE ${where}`,
        values,
      )
    ).rows[0].total,
  );
  const page = Math.min(
    requestedPage,
    Math.max(1, Math.ceil(total / pageSize) || 1),
  );
  const orders = (
    await db.query<ResultWorkItem>(
      `SELECT o.id,o.order_number,o.status,o.priority,COALESCE(o.ordered_at::text,'') AS ordered_at,
 p.patient_number,p.first_name AS patient_first_name,p.last_name AS patient_last_name,
 (SELECT count(*)::text FROM lab_order_tests t WHERE t.organization_id=o.organization_id
   AND t.order_id=o.id AND t.status='ACTIVE' AND NOT EXISTS (
    SELECT 1 FROM lab_results r WHERE r.organization_id=t.organization_id AND r.order_test_id=t.id
     AND r.is_current)) AS pending_results,
 (SELECT count(*)::text FROM lab_results r WHERE r.organization_id=o.organization_id
   AND r.order_id=o.id AND r.is_current) AS entered_results
 FROM lab_orders o
 JOIN patients p ON p.organization_id=o.organization_id AND p.id=o.patient_id
 WHERE ${where}
 ORDER BY o.updated_at DESC,o.id
 LIMIT $4 OFFSET $5`,
      [...values, pageSize, (page - 1) * pageSize],
    )
  ).rows;
  return { orders, total, page, pageSize };
}

export { orderWithResults };
