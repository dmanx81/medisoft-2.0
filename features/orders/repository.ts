import type { QueryRunner } from '@/lib/db/query';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import {
  addTestsSchema,
  cancelOrderSchema,
  createOrderSchema,
  createSpecimenSchema,
  fieldErrors,
  orderFields,
  orderIdSchema,
  rejectSpecimenSchema,
  searchSchema,
  updateOrderSchema,
  versionSchema,
} from './validation';
import {
  OrderError,
  type LabOrder,
  type LabOrderActivity,
  type LabOrderPage,
  type LabOrderSummary,
  type LabOrderTest,
  type LabSpecimen,
} from './types';

const orderSelect = `o.id,o.organization_id,o.patient_id,o.order_number,o.status,o.priority,
 COALESCE(o.ordered_at::text,'') AS ordered_at,COALESCE(o.ordered_by::text,'') AS ordered_by,
 o.ordering_physician_name,o.clinical_notes,o.fasting_status,o.external_reference,
 o.cancellation_reason,COALESCE(o.cancelled_at::text,'') AS cancelled_at,
 COALESCE(o.cancelled_by::text,'') AS cancelled_by,o.version,o.created_by,o.updated_by,
 o.created_at::text,o.updated_at::text,p.patient_number,p.first_name AS patient_first_name,
 p.last_name AS patient_last_name,p.status AS patient_status,
 COALESCE(ob.name,'') AS ordered_by_name,COALESCE(cb.name,'') AS cancelled_by_name`;
const testSelect = `t.id,t.organization_id,t.order_id,t.lab_test_id,t.code_snapshot,t.name_snapshot,
 t.short_name_snapshot,t.specimen_type_snapshot,t.result_type_snapshot,t.unit_symbol_snapshot,
 t.method_snapshot,COALESCE(t.base_price_snapshot::text,'') AS base_price_snapshot,t.status,
 t.created_at::text,t.created_by`;
const specimenSelect = `s.id,s.organization_id,s.order_id,s.accession_number,s.specimen_type,s.status,
 s.collected_at::text,s.collected_by,COALESCE(col.name,'') AS collected_by_name,
 COALESCE(s.received_at::text,'') AS received_at,COALESCE(s.received_by::text,'') AS received_by,
 COALESCE(rec.name,'') AS received_by_name,s.collection_notes,s.rejection_reason,
 COALESCE(s.rejected_at::text,'') AS rejected_at,COALESCE(s.rejected_by::text,'') AS rejected_by,
 COALESCE(rej.name,'') AS rejected_by_name,s.created_at::text,s.created_by,s.updated_at::text,
 s.updated_by,s.version`;
const coveringJoin = `LEFT JOIN LATERAL (
 SELECT sp.id,sp.status FROM lab_specimen_tests st
 JOIN lab_specimens sp ON sp.organization_id=st.organization_id AND sp.id=st.specimen_id
 WHERE st.organization_id=t.organization_id AND st.order_test_id=t.id
  AND sp.status IN ('COLLECTED','RECEIVED')
 ORDER BY CASE sp.status WHEN 'RECEIVED' THEN 0 ELSE 1 END,sp.collected_at DESC
 LIMIT 1
) cover ON true`;

function permit(principal: Principal, permission: Permission) {
  if (!principal.organizationId || !can(principal.role, permission))
    throw new OrderError(
      403,
      'FORBIDDEN',
      'Your role does not allow this action.',
    );
}
function idValue(id: string, code = 'ORDER_NOT_FOUND', label = 'Order') {
  if (!orderIdSchema.safeParse(id).success)
    throw new OrderError(404, code, `${label} not found.`);
  return id;
}
function notFound(code = 'ORDER_NOT_FOUND', label = 'Order'): never {
  throw new OrderError(404, code, `${label} not found.`);
}
function invalid(error: Parameters<typeof fieldErrors>[0]): never {
  throw new OrderError(
    400,
    'VALIDATION',
    'Check the highlighted fields.',
    fieldErrors(error),
  );
}
function stale(): never {
  throw new OrderError(
    409,
    'STALE_VERSION',
    'This record was updated by another user. Refresh and try again.',
  );
}
function transition(code: string, message: string): never {
  throw new OrderError(409, code, message);
}
function blank(value: string) {
  return value === '' ? null : value;
}
function mapConflict(error: unknown): never {
  if (
    typeof error === 'object' &&
    error &&
    'code' in error &&
    error.code === '23505'
  ) {
    const constraint =
      'constraint' in error ? String(error.constraint) : '';
    if (constraint.includes('lab_order_tests') && constraint.includes('lab_test'))
      throw new OrderError(
        409,
        'DUPLICATE_ORDER_TEST',
        'This test is already on the order.',
      );
    if (constraint.includes('order_number'))
      throw new OrderError(
        409,
        'CONFLICT',
        'An order number collision occurred. Please retry.',
      );
    if (constraint.includes('accession'))
      throw new OrderError(
        409,
        'CONFLICT',
        'An accession number collision occurred. Please retry.',
      );
    throw new OrderError(409, 'CONFLICT', 'A matching laboratory record exists.');
  }
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
    if (error instanceof OrderError) throw error;
    mapConflict(error);
  }
}
async function lockOrganization(db: QueryRunner, principal: Principal) {
  await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [
    principal.organizationId,
  ]);
}
function specimenCompatible(specimenType: string, expected: string) {
  return expected === 'OTHER' || expected === specimenType;
}
async function allocateOrderNumber(db: QueryRunner, organizationId: string) {
  const row = (
    await db.query<{ year: string; last_number: string }>(
      `INSERT INTO lab_order_counters(organization_id,year,last_number)
 VALUES($1,EXTRACT(YEAR FROM CURRENT_TIMESTAMP)::integer,1)
 ON CONFLICT(organization_id,year)
 DO UPDATE SET last_number=lab_order_counters.last_number+1
 RETURNING year::text,last_number::text`,
      [organizationId],
    )
  ).rows[0];
  return `LAB-${row.year}-${row.last_number.padStart(6, '0')}`;
}
async function allocateAccessionNumber(
  db: QueryRunner,
  organizationId: string,
) {
  const row = (
    await db.query<{ year: string; last_number: string }>(
      `INSERT INTO lab_accession_counters(organization_id,year,last_number)
 VALUES($1,EXTRACT(YEAR FROM CURRENT_TIMESTAMP)::integer,1)
 ON CONFLICT(organization_id,year)
 DO UPDATE SET last_number=lab_accession_counters.last_number+1
 RETURNING year::text,last_number::text`,
      [organizationId],
    )
  ).rows[0];
  return `ACC-${row.year}-${row.last_number.padStart(6, '0')}`;
}
async function requirePatient(
  db: QueryRunner,
  principal: Principal,
  patientId: string,
) {
  if (!orderIdSchema.safeParse(patientId).success) notFound('PATIENT_NOT_FOUND', 'Patient');
  const row = (
    await db.query<{ id: string; status: string }>(
      'SELECT id,status FROM patients WHERE organization_id=$1 AND id=$2',
      [principal.organizationId, patientId],
    )
  ).rows[0];
  if (!row) notFound('PATIENT_NOT_FOUND', 'Patient');
  if (row.status !== 'ACTIVE')
    throw new OrderError(400, 'VALIDATION', 'Select an active patient.', {
      patient_id: 'This patient is inactive.',
    });
  return row;
}
type LockedOrder = {
  id: string;
  status: string;
  version: number;
  patient_id: string;
};
async function lockOrder(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<LockedOrder> {
  const row = (
    await db.query<LockedOrder>(
      `SELECT id,status,version,patient_id FROM lab_orders
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [principal.organizationId, idValue(id)],
    )
  ).rows[0];
  return row ?? notFound();
}
async function loadTests(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
): Promise<LabOrderTest[]> {
  return (
    await db.query<LabOrderTest>(
      `SELECT ${testSelect},COALESCE(cover.id::text,'') AS covering_specimen_id,
 COALESCE(cover.status,'') AS covering_status
 FROM lab_order_tests t ${coveringJoin}
 WHERE t.organization_id=$1 AND t.order_id=$2
 ORDER BY t.created_at,t.code_snapshot,t.id`,
      [principal.organizationId, orderId],
    )
  ).rows;
}
async function loadSpecimens(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
): Promise<LabSpecimen[]> {
  const rows = (
    await db.query<Omit<LabSpecimen, 'order_test_ids'> & { order_test_ids: string }>(
      `SELECT ${specimenSelect},
 COALESCE((SELECT string_agg(st.order_test_id::text,',' ORDER BY st.created_at)
  FROM lab_specimen_tests st WHERE st.organization_id=s.organization_id AND st.specimen_id=s.id),'')
  AS order_test_ids
 FROM lab_specimens s
 JOIN users col ON col.organization_id=s.organization_id AND col.id=s.collected_by
 LEFT JOIN users rec ON rec.organization_id=s.organization_id AND rec.id=s.received_by
 LEFT JOIN users rej ON rej.organization_id=s.organization_id AND rej.id=s.rejected_by
 WHERE s.organization_id=$1 AND s.order_id=$2
 ORDER BY s.created_at,s.accession_number`,
      [principal.organizationId, orderId],
    )
  ).rows;
  return rows.map((row) => ({
    ...row,
    order_test_ids: row.order_test_ids ? row.order_test_ids.split(',') : [],
  }));
}
function coverageFrom(tests: LabOrderTest[]) {
  const active = tests.filter((test) => test.status === 'ACTIVE');
  const covered = active.filter((test) => test.covering_status !== '').length;
  const received = active.filter((test) => test.covering_status === 'RECEIVED')
    .length;
  return { test_count: active.length, covered_count: covered, received_count: received };
}
function derivedStatus(
  current: string,
  tests: LabOrderTest[],
): string {
  if (
    current === 'DRAFT' ||
    current === 'CANCELLED' ||
    current === 'IN_PROCESS' ||
    current === 'COMPLETED'
  )
    return current;
  const { test_count, covered_count, received_count } = coverageFrom(tests);
  if (test_count === 0 || covered_count === 0) return 'ORDERED';
  if (covered_count < test_count) return 'PARTIALLY_COLLECTED';
  if (received_count === test_count) return 'RECEIVED';
  return 'COLLECTED';
}
async function applyDerivedStatus(
  db: QueryRunner,
  principal: Principal,
  order: LockedOrder,
  tests: LabOrderTest[],
) {
  const next = derivedStatus(order.status, tests);
  if (next === order.status) return;
  await db.query(
    `UPDATE lab_orders SET status=$3,updated_by=$4,version=version+1
 WHERE organization_id=$1 AND id=$2`,
    [principal.organizationId, order.id, next, principal.userId],
  );
}
export async function getOrder(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<LabOrder> {
  permit(principal, 'orders:read');
  const row = (
    await db.query<Omit<LabOrder, 'tests' | 'specimens' | 'results' | 'reports' | 'test_count' | 'covered_count' | 'received_count'>>(
      `SELECT ${orderSelect} FROM lab_orders o
 JOIN patients p ON p.organization_id=o.organization_id AND p.id=o.patient_id
 LEFT JOIN users ob ON ob.organization_id=o.organization_id AND ob.id=o.ordered_by
 LEFT JOIN users cb ON cb.organization_id=o.organization_id AND cb.id=o.cancelled_by
 WHERE o.organization_id=$1 AND o.id=$2`,
      [principal.organizationId, idValue(id)],
    )
  ).rows[0];
  if (!row) notFound();
  const tests = await loadTests(db, principal, row.id);
  const specimens = await loadSpecimens(db, principal, row.id);
  return { ...row, tests, specimens, results: [], reports: [], ...coverageFrom(tests) };
}
export async function listOrders(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<LabOrderPage> {
  permit(principal, 'orders:read');
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  const {
    query,
    page: requestedPage,
    pageSize,
    sort,
    direction,
    status,
    priority,
    patient_id,
    ordered_from,
    ordered_to,
  } = parsed.data;
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const where = `o.organization_id=$1 AND ($2='ALL' OR o.status=$2) AND ($3='ALL' OR o.priority=$3)
 AND ($4='' OR o.patient_id=$4::uuid) AND ($5='' OR o.order_number ILIKE $6
 OR p.first_name ILIKE $6 OR p.last_name ILIKE $6
 OR (p.first_name || ' ' || p.last_name) ILIKE $6 OR p.patient_number ILIKE $6)
 AND ($7='' OR o.ordered_at >= $7::timestamptz OR (o.ordered_at IS NULL AND o.created_at >= $7::timestamptz))
 AND ($8='' OR o.ordered_at < ($8::date + interval '1 day')
  OR (o.ordered_at IS NULL AND o.created_at < ($8::date + interval '1 day')))`;
  const values = [
    principal.organizationId,
    status,
    priority,
    patient_id,
    query,
    pattern,
    ordered_from,
    ordered_to,
  ];
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
  const sorts = {
    ordered_at: 'o.ordered_at',
    order_number: 'o.order_number',
    status: 'o.status',
    updated_at: 'o.updated_at',
  };
  const orders = (
    await db.query<LabOrderSummary>(
      `SELECT o.id,o.order_number,o.status,o.priority,COALESCE(o.ordered_at::text,'') AS ordered_at,
 o.created_at::text,o.updated_at::text,o.patient_id,p.patient_number,
 p.first_name AS patient_first_name,p.last_name AS patient_last_name,
 (SELECT count(*)::text FROM lab_order_tests t WHERE t.organization_id=o.organization_id
   AND t.order_id=o.id AND t.status='ACTIVE') AS test_count,
 (SELECT count(*)::text FROM lab_order_tests t ${coveringJoin}
   WHERE t.organization_id=o.organization_id AND t.order_id=o.id AND t.status='ACTIVE'
    AND cover.id IS NOT NULL) AS covered_count,
 (SELECT count(*)::text FROM lab_order_tests t ${coveringJoin}
   WHERE t.organization_id=o.organization_id AND t.order_id=o.id AND t.status='ACTIVE'
    AND cover.status='RECEIVED') AS received_count,
 (SELECT count(*)::text FROM lab_specimens s WHERE s.organization_id=o.organization_id
   AND s.order_id=o.id) AS specimen_count
 FROM lab_orders o
 JOIN patients p ON p.organization_id=o.organization_id AND p.id=o.patient_id
 WHERE ${where}
 ORDER BY ${sorts[sort]} ${direction === 'desc' ? 'DESC' : 'ASC'} NULLS LAST,o.id
 LIMIT $9 OFFSET $10`,
      [...values, pageSize, (page - 1) * pageSize],
    )
  ).rows;
  return { orders, total, page, pageSize };
}
async function snapshotCatalogueTests(
  db: QueryRunner,
  principal: Principal,
  testIds: string[],
) {
  const unique = [...new Set(testIds)];
  if (unique.length !== testIds.length)
    throw new OrderError(
      409,
      'DUPLICATE_ORDER_TEST',
      'This test is already on the order.',
    );
  const rows = (
    await db.query<{
      id: string;
      code: string;
      name: string;
      short_name: string;
      specimen_type: string;
      result_type: string;
      method: string;
      is_active: boolean;
      unit_symbol: string;
      base_price: string;
    }>(
      `SELECT t.id,t.code,t.name,t.short_name,t.specimen_type,t.result_type,t.method,t.is_active,
 COALESCE(u.symbol,'') AS unit_symbol,COALESCE(t.base_price::text,'') AS base_price
 FROM lab_tests t
 LEFT JOIN lab_units u ON u.organization_id=t.organization_id AND u.id=t.unit_id
 WHERE t.organization_id=$1 AND t.id = ANY($2::uuid[])`,
      [principal.organizationId, unique],
    )
  ).rows;
  if (rows.length !== unique.length) {
    throw new OrderError(400, 'VALIDATION', 'Select tests from the catalogue.', {
      test_ids: 'One or more tests are not available in your organization.',
    });
  }
  const inactive = rows.find((row) => !row.is_active);
  if (inactive)
    throw new OrderError(
      409,
      'TEST_INACTIVE',
      'Inactive catalogue tests cannot be newly ordered.',
      { test_ids: `${inactive.code} is inactive.` },
    );
  return rows;
}
async function insertOrderTests(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
  testIds: string[],
) {
  const snapshots = await snapshotCatalogueTests(db, principal, testIds);
  for (const test of snapshots) {
    const inserted = (
      await db.query<{ id: string }>(
        `INSERT INTO lab_order_tests(
 organization_id,order_id,lab_test_id,code_snapshot,name_snapshot,short_name_snapshot,
 specimen_type_snapshot,result_type_snapshot,unit_symbol_snapshot,method_snapshot,
 base_price_snapshot,created_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          principal.organizationId,
          orderId,
          test.id,
          test.code,
          test.name,
          test.short_name,
          test.specimen_type,
          test.result_type,
          test.unit_symbol,
          test.method,
          blank(test.base_price),
          principal.userId,
        ],
      )
    ).rows[0];
    await audit(db, principal, 'LAB_ORDER_TEST', inserted.id, 'LAB_ORDER_TEST_ADDED', {
      order_id: orderId,
      lab_test_id: test.id,
      fields: [
        'code_snapshot',
        'name_snapshot',
        'specimen_type_snapshot',
        'result_type_snapshot',
        'unit_symbol_snapshot',
        'method_snapshot',
        'base_price_snapshot',
      ],
    });
  }
}
async function placeLockedOrder(
  db: QueryRunner,
  principal: Principal,
  order: LockedOrder,
) {
  if (order.status !== 'DRAFT')
    transition(
      'INVALID_ORDER_TRANSITION',
      'Only draft orders can be placed.',
    );
  const tests = await loadTests(db, principal, order.id);
  if (coverageFrom(tests).test_count === 0)
    throw new OrderError(400, 'VALIDATION', 'Add at least one test before placing the order.', {
      test_ids: 'Select at least one laboratory test.',
    });
  await requirePatient(db, principal, order.patient_id);
  await db.query(
    `UPDATE lab_orders SET status='ORDERED',ordered_at=now(),ordered_by=$3,updated_by=$3,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$4 AND status='DRAFT'`,
    [
      principal.organizationId,
      order.id,
      principal.userId,
      Number(order.version),
    ],
  );
  await audit(db, principal, 'LAB_ORDER', order.id, 'LAB_ORDER_PLACED', {
    from: 'DRAFT',
    to: 'ORDERED',
  });
}
export async function createOrder(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<LabOrder> {
  permit(principal, 'orders:create');
  permit(principal, 'orders:read');
  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  if (parsed.data.place) permit(principal, 'orders:place');
  const { data, place } = parsed.data;
  return transaction(db, async () => {
    await lockOrganization(db, principal);
    await requirePatient(db, principal, data.patient_id);
    const orderNumber = await allocateOrderNumber(
      db,
      principal.organizationId,
    );
    const id = (
      await db.query<{ id: string }>(
        `INSERT INTO lab_orders(
 organization_id,patient_id,order_number,priority,ordering_physician_name,clinical_notes,
 fasting_status,external_reference,created_by,updated_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id`,
        [
          principal.organizationId,
          data.patient_id,
          orderNumber,
          data.priority,
          data.ordering_physician_name,
          data.clinical_notes,
          data.fasting_status,
          data.external_reference,
          principal.userId,
        ],
      )
    ).rows[0].id;
    await audit(db, principal, 'LAB_ORDER', id, 'LAB_ORDER_CREATED', {
      fields: Object.keys(orderFields.shape),
    });
    if (data.test_ids.length) await insertOrderTests(db, principal, id, data.test_ids);
    if (place) {
      const locked = await lockOrder(db, principal, id);
      await placeLockedOrder(db, principal, locked);
    }
    return getOrder(db, principal, id);
  });
}
export async function updateOrder(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<LabOrder> {
  permit(principal, 'orders:edit');
  permit(principal, 'orders:read');
  const parsed = updateOrderSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    await lockOrganization(db, principal);
    const order = await lockOrder(db, principal, id);
    if (Number(order.version) !== parsed.data.version) stale();
    if (order.status !== 'DRAFT')
      throw new OrderError(
        409,
        'INVALID_ORDER_STATUS',
        'Placed orders cannot be rewritten. Cancel or collect specimens instead.',
      );
    await requirePatient(db, principal, parsed.data.data.patient_id);
    const data = parsed.data.data;
    await db.query(
      `UPDATE lab_orders SET patient_id=$3,priority=$4,ordering_physician_name=$5,clinical_notes=$6,
 fasting_status=$7,external_reference=$8,updated_by=$9,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$10 AND status='DRAFT'`,
      [
        principal.organizationId,
        order.id,
        data.patient_id,
        data.priority,
        data.ordering_physician_name,
        data.clinical_notes,
        data.fasting_status,
        data.external_reference,
        principal.userId,
        Number(order.version),
      ],
    );
    await audit(db, principal, 'LAB_ORDER', order.id, 'LAB_ORDER_UPDATED', {
      fields: Object.keys(orderFields.shape),
    });
    return getOrder(db, principal, order.id);
  });
}
export async function addOrderTests(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<LabOrder> {
  permit(principal, 'orders:edit');
  permit(principal, 'orders:read');
  const parsed = addTestsSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    await lockOrganization(db, principal);
    const order = await lockOrder(db, principal, id);
    if (Number(order.version) !== parsed.data.version) stale();
    if (order.status !== 'DRAFT')
      throw new OrderError(
        409,
        'INVALID_ORDER_STATUS',
        'Tests cannot be added after an order is placed.',
      );
    await insertOrderTests(db, principal, order.id, parsed.data.test_ids);
    await db.query(
      `UPDATE lab_orders SET updated_by=$3,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$4`,
      [
        principal.organizationId,
        order.id,
        principal.userId,
        Number(order.version),
      ],
    );
    return getOrder(db, principal, order.id);
  });
}
export async function removeOrderTest(
  db: QueryRunner,
  principal: Principal,
  id: string,
  testId: string,
  input: unknown,
): Promise<LabOrder> {
  permit(principal, 'orders:edit');
  permit(principal, 'orders:read');
  const parsed = versionSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  idValue(testId);
  return transaction(db, async () => {
    await lockOrganization(db, principal);
    const order = await lockOrder(db, principal, id);
    if (Number(order.version) !== parsed.data.version) stale();
    if (order.status !== 'DRAFT')
      throw new OrderError(
        409,
        'INVALID_ORDER_STATUS',
        'Ordered tests are preserved after an order is placed.',
      );
    const existing = (
      await db.query<{ id: string; lab_test_id: string }>(
        `SELECT id,lab_test_id FROM lab_order_tests
 WHERE organization_id=$1 AND order_id=$2 AND id=$3`,
        [principal.organizationId, order.id, testId],
      )
    ).rows[0];
    if (!existing) notFound();
    await db.query(
      'DELETE FROM lab_order_tests WHERE organization_id=$1 AND id=$2',
      [principal.organizationId, testId],
    );
    await db.query(
      `UPDATE lab_orders SET updated_by=$3,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$4`,
      [
        principal.organizationId,
        order.id,
        principal.userId,
        Number(order.version),
      ],
    );
    await audit(db, principal, 'LAB_ORDER_TEST', testId, 'LAB_ORDER_TEST_REMOVED', {
      order_id: order.id,
      lab_test_id: existing.lab_test_id,
    });
    return getOrder(db, principal, order.id);
  });
}
export async function placeOrder(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<LabOrder> {
  permit(principal, 'orders:place');
  permit(principal, 'orders:read');
  const parsed = versionSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    await lockOrganization(db, principal);
    const order = await lockOrder(db, principal, id);
    if (Number(order.version) !== parsed.data.version) stale();
    await placeLockedOrder(db, principal, order);
    return getOrder(db, principal, order.id);
  });
}
export async function cancelOrder(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<LabOrder> {
  permit(principal, 'orders:cancel');
  permit(principal, 'orders:read');
  const parsed = cancelOrderSchema.safeParse(input);
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    if (errors.reason)
      throw new OrderError(
        400,
        'ORDER_CANCELLATION_REASON_REQUIRED',
        'Cancellation reason is required.',
        errors,
      );
    invalid(parsed.error);
  }
  return transaction(db, async () => {
    await lockOrganization(db, principal);
    const order = await lockOrder(db, principal, id);
    if (Number(order.version) !== parsed.data.version) stale();
    if (order.status !== 'DRAFT' && order.status !== 'ORDERED')
      transition(
        'INVALID_ORDER_TRANSITION',
        'Orders with collected or received specimens cannot be cancelled.',
      );
    const tests = (
      await db.query<{ id: string }>(
        `SELECT id FROM lab_order_tests WHERE organization_id=$1 AND order_id=$2 AND status='ACTIVE'`,
        [principal.organizationId, order.id],
      )
    ).rows;
    await db.query(
      `UPDATE lab_order_tests SET status='CANCELLED'
 WHERE organization_id=$1 AND order_id=$2 AND status='ACTIVE'`,
      [principal.organizationId, order.id],
    );
    await db.query(
      `UPDATE lab_orders SET status='CANCELLED',cancellation_reason=$3,cancelled_at=now(),
 cancelled_by=$4,updated_by=$4,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$5 AND status IN ('DRAFT','ORDERED')`,
      [
        principal.organizationId,
        order.id,
        parsed.data.reason,
        principal.userId,
        Number(order.version),
      ],
    );
    await audit(db, principal, 'LAB_ORDER', order.id, 'LAB_ORDER_CANCELLED', {
      from: order.status,
      to: 'CANCELLED',
      reason: parsed.data.reason,
    });
    for (const test of tests)
      await audit(
        db,
        principal,
        'LAB_ORDER_TEST',
        test.id,
        'LAB_ORDER_TEST_CANCELLED',
        { order_id: order.id },
      );
    return getOrder(db, principal, order.id);
  });
}
export async function createSpecimen(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
  input: unknown,
): Promise<LabOrder> {
  permit(principal, 'samples:collect');
  permit(principal, 'orders:read');
  const parsed = createSpecimenSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    await lockOrganization(db, principal);
    const order = await lockOrder(db, principal, orderId);
    if (Number(order.version) !== parsed.data.version) stale();
    if (
      !['ORDERED', 'PARTIALLY_COLLECTED', 'COLLECTED'].includes(order.status)
    )
      throw new OrderError(
        409,
        'INVALID_ORDER_STATUS',
        'Specimens can be collected only for placed orders that still need coverage.',
      );
    const unique = [...new Set(parsed.data.order_test_ids)];
    const tests = (
      await db.query<LabOrderTest>(
        `SELECT ${testSelect},'' AS covering_specimen_id,'' AS covering_status
 FROM lab_order_tests t
 WHERE t.organization_id=$1 AND t.order_id=$2 AND t.id = ANY($3::uuid[])`,
        [principal.organizationId, order.id, unique],
      )
    ).rows;
    if (tests.length !== unique.length)
      throw new OrderError(
        400,
        'VALIDATION',
        'Select ordered tests from this order.',
        { order_test_ids: 'One or more ordered tests are not on this order.' },
      );
    const current = await loadTests(db, principal, order.id);
    for (const test of tests) {
      if (test.status !== 'ACTIVE')
        throw new OrderError(
          409,
          'INVALID_ORDER_STATUS',
          'Cancelled ordered tests cannot be linked to a specimen.',
        );
      if (!specimenCompatible(parsed.data.specimen_type, test.specimen_type_snapshot))
        throw new OrderError(
          409,
          'SPECIMEN_TEST_MISMATCH',
          `${test.code_snapshot} requires ${test.specimen_type_snapshot}, not ${parsed.data.specimen_type}.`,
        );
      const covered = current.find((row) => row.id === test.id);
      if (covered?.covering_status)
        throw new OrderError(
          409,
          'DUPLICATE_ORDER_TEST',
          `${test.code_snapshot} already has a collected or received specimen.`,
        );
    }
    const collectedAt = parsed.data.collected_at
      ? parsed.data.collected_at
      : new Date().toISOString();
    const accession = await allocateAccessionNumber(
      db,
      principal.organizationId,
    );
    const specimenId = (
      await db.query<{ id: string }>(
        `INSERT INTO lab_specimens(
 organization_id,order_id,accession_number,specimen_type,status,collected_at,collected_by,
 collection_notes,created_by,updated_by)
 VALUES($1,$2,$3,$4,'COLLECTED',$5,$6,$7,$6,$6) RETURNING id`,
        [
          principal.organizationId,
          order.id,
          accession,
          parsed.data.specimen_type,
          collectedAt,
          principal.userId,
          parsed.data.collection_notes,
        ],
      )
    ).rows[0].id;
    await audit(db, principal, 'LAB_SPECIMEN', specimenId, 'SPECIMEN_CREATED', {
      order_id: order.id,
      specimen_type: parsed.data.specimen_type,
    });
    await audit(db, principal, 'LAB_SPECIMEN', specimenId, 'SPECIMEN_COLLECTED', {
      order_id: order.id,
      from: null,
      to: 'COLLECTED',
    });
    for (const test of tests) {
      await db.query(
        `INSERT INTO lab_specimen_tests(
 organization_id,order_id,specimen_id,order_test_id,created_by)
 VALUES($1,$2,$3,$4,$5)`,
        [
          principal.organizationId,
          order.id,
          specimenId,
          test.id,
          principal.userId,
        ],
      );
    }
    await audit(db, principal, 'LAB_SPECIMEN', specimenId, 'SPECIMEN_TEST_LINKED', {
      order_id: order.id,
      order_test_ids: tests.map((test) => test.id),
    });
    const after = await loadTests(db, principal, order.id);
    await db.query(
      `UPDATE lab_orders SET status=$3,updated_by=$4,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$5`,
      [
        principal.organizationId,
        order.id,
        derivedStatus(order.status, after),
        principal.userId,
        Number(order.version),
      ],
    );
    return getOrder(db, principal, order.id);
  });
}
async function lockSpecimen(
  db: QueryRunner,
  principal: Principal,
  id: string,
) {
  const row = (
    await db.query<{
      id: string;
      order_id: string;
      status: string;
      version: number;
    }>(
      `SELECT id,order_id,status,version FROM lab_specimens
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [
        principal.organizationId,
        idValue(id, 'SPECIMEN_NOT_FOUND', 'Specimen'),
      ],
    )
  ).rows[0];
  return row ?? notFound('SPECIMEN_NOT_FOUND', 'Specimen');
}
export async function receiveSpecimen(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<LabOrder> {
  permit(principal, 'samples:receive');
  permit(principal, 'orders:read');
  const parsed = versionSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    await lockOrganization(db, principal);
    const specimen = await lockSpecimen(db, principal, id);
    if (Number(specimen.version) !== parsed.data.version) stale();
    if (specimen.status !== 'COLLECTED')
      transition(
        'INVALID_SPECIMEN_TRANSITION',
        'Only collected specimens can be received.',
      );
    const order = await lockOrder(db, principal, specimen.order_id);
    if (order.status === 'CANCELLED')
      throw new OrderError(
        409,
        'INVALID_ORDER_STATUS',
        'Cancelled orders cannot receive specimens.',
      );
    await db.query(
      `UPDATE lab_specimens SET status='RECEIVED',received_at=now(),received_by=$3,updated_by=$3,
 version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$4 AND status='COLLECTED'`,
      [
        principal.organizationId,
        specimen.id,
        principal.userId,
        Number(specimen.version),
      ],
    );
    await audit(db, principal, 'LAB_SPECIMEN', specimen.id, 'SPECIMEN_RECEIVED', {
      order_id: order.id,
      from: 'COLLECTED',
      to: 'RECEIVED',
    });
    const tests = await loadTests(db, principal, order.id);
    await applyDerivedStatus(db, principal, order, tests);
    return getOrder(db, principal, order.id);
  });
}
export async function rejectSpecimen(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<LabOrder> {
  permit(principal, 'samples:reject');
  permit(principal, 'orders:read');
  const parsed = rejectSpecimenSchema.safeParse(input);
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    if (errors.reason)
      throw new OrderError(
        400,
        'SPECIMEN_REJECTION_REASON_REQUIRED',
        'Rejection reason is required.',
        errors,
      );
    invalid(parsed.error);
  }
  return transaction(db, async () => {
    await lockOrganization(db, principal);
    const specimen = await lockSpecimen(db, principal, id);
    if (Number(specimen.version) !== parsed.data.version) stale();
    if (specimen.status !== 'COLLECTED' && specimen.status !== 'RECEIVED')
      transition(
        'INVALID_SPECIMEN_TRANSITION',
        'Only collected or received specimens can be rejected.',
      );
    const order = await lockOrder(db, principal, specimen.order_id);
    await db.query(
      `UPDATE lab_specimens SET status='REJECTED',rejection_reason=$3,rejected_at=now(),
 rejected_by=$4,updated_by=$4,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$5 AND status IN ('COLLECTED','RECEIVED')`,
      [
        principal.organizationId,
        specimen.id,
        parsed.data.reason,
        principal.userId,
        Number(specimen.version),
      ],
    );
    await audit(db, principal, 'LAB_SPECIMEN', specimen.id, 'SPECIMEN_REJECTED', {
      order_id: order.id,
      from: specimen.status,
      to: 'REJECTED',
      reason: parsed.data.reason,
    });
    const tests = await loadTests(db, principal, order.id);
    await applyDerivedStatus(db, principal, order, tests);
    return getOrder(db, principal, order.id);
  });
}
export async function listOrderActivity(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<LabOrderActivity[]> {
  permit(principal, 'orders:read');
  await getOrder(db, principal, id);
  return (
    await db.query<LabOrderActivity>(
      `SELECT a.id,a.action,a.occurred_at::text,COALESCE(u.name,'Unknown') AS actor,
 a.entity_type,COALESCE(a.entity_id,'') AS entity_id,a.metadata
 FROM audit_events a
 LEFT JOIN users u ON u.id=a.user_id AND u.organization_id=a.organization_id
 WHERE a.organization_id=$1 AND (
  (a.entity_type='LAB_ORDER' AND a.entity_id=$2)
  OR a.metadata->>'order_id'=$2
 )
 ORDER BY a.occurred_at,a.id`,
      [principal.organizationId, idValue(id)],
    )
  ).rows;
}
