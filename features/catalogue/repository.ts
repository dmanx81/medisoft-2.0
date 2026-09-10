import type { QueryRunner } from '@/lib/db/query';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import {
  catalogueIdSchema,
  catalogueFieldNames,
  categorySchema,
  createRangeSchema,
  createTestSchema,
  fieldErrors,
  replaceRangeSchema,
  retireRangeSchema,
  searchSchema,
  unitSchema,
  updateTestSchema,
  type CatalogueInput,
  type RangeInput,
} from './validation';
import {
  CatalogueError,
  type CatalogueLookups,
  type LabCategory,
  type LabRange,
  type LabTest,
  type LabTestPage,
  type LabUnit,
} from './types';

const testFields = catalogueFieldNames;
const testSelect = `t.id,t.organization_id,t.category_id,t.code,t.name,t.short_name,t.description,
 t.specimen_type,t.result_type,COALESCE(t.unit_id::text,'') AS unit_id,t.method,t.display_order,
 COALESCE(t.base_price::text,'') AS base_price,t.is_active,t.version,t.created_by,t.updated_by,
 t.created_at::text,t.updated_at::text,c.name AS category_name,c.code AS category_code,
 COALESCE(u.symbol,'') AS unit_symbol,COALESCE(u.name,'') AS unit_name`;
const rangeSelect = `r.id,r.organization_id,r.test_id,r.sex,COALESCE(r.age_min::text,'') AS age_min,
 COALESCE(r.age_max::text,'') AS age_max,r.age_unit,COALESCE(r.lower_bound::text,'') AS lower_bound,
 COALESCE(r.upper_bound::text,'') AS upper_bound,r.lower_operator,r.upper_operator,r.text_range,
 COALESCE(r.unit_id::text,'') AS unit_id,r.method,COALESCE(r.critical_low::text,'') AS critical_low,
 COALESCE(r.critical_high::text,'') AS critical_high,r.valid_from::text,COALESCE(r.valid_to::text,'') AS valid_to,
 r.is_active,r.range_version,COALESCE(r.supersedes_id::text,'') AS supersedes_id,
 COALESCE(r.successor_id::text,'') AS successor_id,r.created_by,r.created_at::text,
 COALESCE(r.retired_at::text,'') AS retired_at,COALESCE(r.retired_by::text,'') AS retired_by,r.version,
 COALESCE(u.symbol,'') AS unit_symbol`;
function permit(principal: Principal, permission: Permission) {
  if (!principal.organizationId || !can(principal.role, permission))
    throw new CatalogueError(
      403,
      'FORBIDDEN',
      'Your role does not allow this action.',
    );
}
function idValue(id: string, label = 'Test') {
  if (!catalogueIdSchema.safeParse(id).success)
    throw new CatalogueError(404, 'NOT_FOUND', `${label} not found.`);
  return id;
}
function notFound(label = 'Test'): never {
  throw new CatalogueError(404, 'NOT_FOUND', `${label} not found.`);
}
function invalid(error: Parameters<typeof fieldErrors>[0]): never {
  throw new CatalogueError(
    400,
    'VALIDATION',
    'Check the highlighted fields.',
    fieldErrors(error),
  );
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
    if (constraint.includes('lab_tests') && constraint.includes('code'))
      throw new CatalogueError(
        409,
        'DUPLICATE_CODE',
        'This test code already exists in your organization.',
        { code: 'Use a different code.' },
      );
    if (constraint.includes('lab_test_categories'))
      throw new CatalogueError(
        409,
        'DUPLICATE_CATEGORY',
        'This category code already exists in your organization.',
        { code: 'Use a different category code.' },
      );
    if (constraint.includes('lab_units'))
      throw new CatalogueError(
        409,
        'DUPLICATE_UNIT',
        'This unit already exists in your organization.',
        { code: 'Select the existing unit.' },
      );
    throw new CatalogueError(
      409,
      'CONFLICT',
      'A matching catalogue record already exists.',
    );
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
    if (error instanceof CatalogueError) throw error;
    mapConflict(error);
  }
}
async function lockOrganization(db: QueryRunner, principal: Principal) {
  await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [
    principal.organizationId,
  ]);
}
async function ownedCategory(
  db: QueryRunner,
  principal: Principal,
  categoryId: string,
) {
  const row = (
    await db.query<LabCategory>(
      `SELECT id,code,name,display_order,is_active FROM lab_test_categories
 WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, categoryId],
    )
  ).rows[0];
  if (!row)
    throw new CatalogueError(400, 'VALIDATION', 'Select a valid category.', {
      category_id: 'Category is not available in your organization.',
    });
  return row;
}
async function ownedUnit(
  db: QueryRunner,
  principal: Principal,
  unitId: string,
) {
  if (!unitId) return null;
  const row = (
    await db.query<LabUnit>(
      `SELECT id,code,symbol,name FROM lab_units WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, unitId],
    )
  ).rows[0];
  if (!row)
    throw new CatalogueError(400, 'VALIDATION', 'Select a valid unit.', {
      unit_id: 'Unit is not available in your organization.',
    });
  return row;
}
export async function getTest(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<LabTest> {
  permit(principal, 'tests:read');
  const result = await db.query<LabTest>(
    `SELECT ${testSelect} FROM lab_tests t
 JOIN lab_test_categories c ON c.organization_id=t.organization_id AND c.id=t.category_id
 LEFT JOIN lab_units u ON u.organization_id=t.organization_id AND u.id=t.unit_id
 WHERE t.organization_id=$1 AND t.id=$2`,
    [principal.organizationId, idValue(id)],
  );
  return result.rows[0] ?? notFound();
}
export async function listTests(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<LabTestPage> {
  permit(principal, 'tests:read');
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  const {
    query,
    page: requestedPage,
    pageSize,
    sort,
    direction,
    status,
    category_id,
  } = parsed.data;
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const where = `t.organization_id=$1 AND ($2='ALL' OR t.is_active=($2='ACTIVE'))
 AND ($3='' OR t.category_id=$3::uuid) AND ($4='' OR t.code ILIKE $5 OR t.name ILIKE $5
 OR t.short_name ILIKE $5 OR c.name ILIKE $5)`;
  const values = [
    principal.organizationId,
    status,
    category_id,
    query,
    pattern,
  ];
  const total = Number(
    (
      await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM lab_tests t
 JOIN lab_test_categories c ON c.organization_id=t.organization_id AND c.id=t.category_id
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
    code: 't.code',
    name: 'lower(t.name)',
    category: 'lower(c.name),t.code',
    updated_at: 't.updated_at',
  };
  const order = sorts[sort]
    .split(',')
    .map(
      (column) =>
        `${column} ${direction === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`,
    )
    .join(',');
  const tests = (
    await db.query<LabTestPage['tests'][number]>(
      `SELECT t.id,t.code,t.name,t.short_name,t.category_id,c.name AS category_name,t.specimen_type,
 t.result_type,COALESCE(t.unit_id::text,'') AS unit_id,COALESCE(u.symbol,'') AS unit_symbol,
 t.is_active,t.display_order,t.updated_at::text
 FROM lab_tests t
 JOIN lab_test_categories c ON c.organization_id=t.organization_id AND c.id=t.category_id
 LEFT JOIN lab_units u ON u.organization_id=t.organization_id AND u.id=t.unit_id
 WHERE ${where} ORDER BY ${order},t.id LIMIT $6 OFFSET $7`,
      [...values, pageSize, (page - 1) * pageSize],
    )
  ).rows;
  return { tests, total, page, pageSize };
}
export async function listLookups(
  db: QueryRunner,
  principal: Principal,
): Promise<CatalogueLookups> {
  permit(principal, 'tests:read');
  const categories = (
    await db.query<LabCategory>(
      `SELECT id,code,name,display_order,is_active FROM lab_test_categories
 WHERE organization_id=$1 ORDER BY display_order,name,code`,
      [principal.organizationId],
    )
  ).rows;
  const units = (
    await db.query<LabUnit>(
      `SELECT id,code,symbol,name FROM lab_units WHERE organization_id=$1 ORDER BY symbol,code`,
      [principal.organizationId],
    )
  ).rows;
  return { categories, units };
}
export async function createCategory(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
) {
  permit(principal, 'tests:edit');
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    await lockOrganization(db, principal);
    const row = (
      await db.query<LabCategory>(
        `INSERT INTO lab_test_categories(organization_id,code,name,display_order)
 VALUES($1,$2,$3,$4) RETURNING id,code,name,display_order,is_active`,
        [
          principal.organizationId,
          parsed.data.code,
          parsed.data.name,
          parsed.data.display_order,
        ],
      )
    ).rows[0];
    await audit(db, principal, 'LAB_TEST_CATEGORY', row.id, 'LAB_CATEGORY_CREATED', {
      fields: ['code', 'name'],
    });
    return row;
  });
}
export async function createUnit(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
) {
  permit(principal, 'tests:edit');
  const parsed = unitSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    await lockOrganization(db, principal);
    const row = (
      await db.query<LabUnit>(
        `INSERT INTO lab_units(organization_id,code,symbol,name) VALUES($1,$2,$3,$4)
 RETURNING id,code,symbol,name`,
        [
          principal.organizationId,
          parsed.data.code,
          parsed.data.symbol,
          parsed.data.name,
        ],
      )
    ).rows[0];
    await audit(db, principal, 'LAB_UNIT', row.id, 'LAB_UNIT_CREATED', {
      fields: ['code', 'symbol'],
    });
    return row;
  });
}
function testValues(data: CatalogueInput) {
  return testFields.map((field) => {
    if (field === 'is_active') return data.is_active;
    if (field === 'display_order') return data.display_order;
    if (field === 'unit_id' || field === 'base_price')
      return blank(String(data[field] ?? ''));
    return String(data[field] ?? '');
  });
}
export async function createTest(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<LabTest> {
  permit(principal, 'tests:create');
  permit(principal, 'tests:read');
  const parsed = createTestSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  const { data } = parsed.data;
  return transaction(db, async () => {
    await lockOrganization(db, principal);
    await ownedCategory(db, principal, data.category_id);
    await ownedUnit(db, principal, data.unit_id);
    const id = (
      await db.query<{ id: string }>(
        `INSERT INTO lab_tests(organization_id,created_by,updated_by,${testFields.join(',')})
 VALUES($1,$2,$2,${testFields.map((_, index) => `$${index + 3}`).join(',')}) RETURNING id`,
        [principal.organizationId, principal.userId, ...testValues(data)],
      )
    ).rows[0].id;
    await audit(db, principal, 'LAB_TEST', id, 'LAB_TEST_CREATED', {
      fields: testFields.filter((field) =>
        field === 'is_active' ? true : !!data[field],
      ),
    });
    return getTest(db, principal, id);
  });
}
export async function updateTest(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<LabTest> {
  permit(principal, 'tests:edit');
  permit(principal, 'tests:read');
  idValue(id);
  const parsed = updateTestSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  const { data, version } = parsed.data;
  return transaction(db, async () => {
    await lockOrganization(db, principal);
    const existing =
      (
        await db.query<LabTest>(
          `SELECT ${testSelect} FROM lab_tests t
 JOIN lab_test_categories c ON c.organization_id=t.organization_id AND c.id=t.category_id
 LEFT JOIN lab_units u ON u.organization_id=t.organization_id AND u.id=t.unit_id
 WHERE t.organization_id=$1 AND t.id=$2 FOR UPDATE OF t`,
          [principal.organizationId, id],
        )
      ).rows[0] ?? notFound();
    if (Number(existing.version) !== version)
      throw new CatalogueError(
        409,
        'STALE_VERSION',
        'This record changed while you were editing. Reload the latest record before saving.',
      );
    await ownedCategory(db, principal, data.category_id);
    await ownedUnit(db, principal, data.unit_id);
    const changed = testFields.filter((field) => {
      if (field === 'is_active') return existing.is_active !== data.is_active;
      if (field === 'display_order')
        return Number(existing.display_order) !== data.display_order;
      return String(existing[field] ?? '') !== String(data[field] ?? '');
    });
    if (!changed.length) return existing;
    await db.query(
      `UPDATE lab_tests SET ${testFields.map((field, index) => `${field}=$${index + 4}`).join(',')},
 updated_by=$3,version=version+1 WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, id, principal.userId, ...testValues(data)],
    );
    await audit(db, principal, 'LAB_TEST', id, 'LAB_TEST_UPDATED', {
      fields: changed,
    });
    if (changed.includes('is_active'))
      await audit(db, principal, 'LAB_TEST', id, 'LAB_TEST_STATUS_CHANGED', {
        fields: ['is_active'],
      });
    if (changed.includes('category_id'))
      await audit(db, principal, 'LAB_TEST', id, 'LAB_TEST_CATEGORY_CHANGED', {
        fields: ['category_id'],
      });
    return getTest(db, principal, id);
  });
}
export async function listRanges(
  db: QueryRunner,
  principal: Principal,
  testId: string,
): Promise<LabRange[]> {
  permit(principal, 'tests:read');
  await getTest(db, principal, testId);
  return (
    await db.query<LabRange>(
      `SELECT ${rangeSelect} FROM lab_reference_ranges r
 LEFT JOIN lab_units u ON u.organization_id=r.organization_id AND u.id=r.unit_id
 WHERE r.organization_id=$1 AND r.test_id=$2
 ORDER BY r.is_active DESC,r.valid_from DESC,r.sex,r.age_min NULLS FIRST,r.id`,
      [principal.organizationId, testId],
    )
  ).rows;
}
async function getOwnedRange(
  db: QueryRunner,
  principal: Principal,
  testId: string,
  rangeId: string,
  forUpdate = false,
) {
  await getTest(db, principal, testId);
  const row = (
    await db.query<LabRange>(
      `SELECT ${rangeSelect} FROM lab_reference_ranges r
 LEFT JOIN lab_units u ON u.organization_id=r.organization_id AND u.id=r.unit_id
 WHERE r.organization_id=$1 AND r.test_id=$2 AND r.id=$3${forUpdate ? ' FOR UPDATE OF r' : ''}`,
      [principal.organizationId, testId, idValue(rangeId, 'Reference range')],
    )
  ).rows[0];
  return row ?? notFound('Reference range');
}
function rangeColumns(data: RangeInput, fallbackUnit: string) {
  return [
    data.sex,
    blank(data.age_min),
    blank(data.age_max),
    data.age_unit,
    blank(data.lower_bound),
    blank(data.upper_bound),
    data.lower_operator,
    data.upper_operator,
    data.text_range,
    blank(data.unit_id || fallbackUnit),
    data.method,
    blank(data.critical_low),
    blank(data.critical_high),
    blank(data.valid_from),
  ];
}
async function assertRangeShape(test: LabTest, data: RangeInput) {
  if (test.result_type === 'NUMERIC' && !data.lower_bound && !data.upper_bound)
    throw new CatalogueError(
      400,
      'VALIDATION',
      'Numeric tests require a lower and/or upper bound.',
      { lower_bound: 'Enter at least one numeric bound.' },
    );
  if (
    test.result_type !== 'NUMERIC' &&
    !data.text_range &&
    !data.lower_bound &&
    !data.upper_bound
  )
    throw new CatalogueError(
      400,
      'VALIDATION',
      'Enter a text range for this result type.',
      { text_range: 'Text range is required.' },
    );
}
async function insertRange(
  db: QueryRunner,
  principal: Principal,
  test: LabTest,
  data: RangeInput,
  supersedesId: string | null,
  rangeVersion: number,
) {
  await ownedUnit(db, principal, data.unit_id || test.unit_id);
  await assertRangeShape(test, data);
  const row = (
    await db.query<{ id: string }>(
      `INSERT INTO lab_reference_ranges(
 organization_id,test_id,sex,age_min,age_max,age_unit,lower_bound,upper_bound,
 lower_operator,upper_operator,text_range,unit_id,method,critical_low,critical_high,
 valid_from,created_by,supersedes_id,range_version)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,COALESCE($16::timestamptz,now()),$17,$18,$19)
 RETURNING id`,
      [
        principal.organizationId,
        test.id,
        ...rangeColumns(data, test.unit_id),
        principal.userId,
        supersedesId,
        rangeVersion,
      ],
    )
  ).rows[0];
  await audit(
    db,
    principal,
    'LAB_REFERENCE_RANGE',
    row.id,
    'REFERENCE_RANGE_CREATED',
    {
      fields: Object.keys(data).filter((field) => {
        const value = data[field as keyof RangeInput];
        return value !== '' && value !== undefined;
      }),
      test_id: test.id,
    },
  );
  return row.id;
}
export async function createRange(
  db: QueryRunner,
  principal: Principal,
  testId: string,
  input: unknown,
): Promise<LabRange> {
  permit(principal, 'tests:edit');
  permit(principal, 'tests:read');
  idValue(testId);
  const parsed = createRangeSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    await lockOrganization(db, principal);
    const test =
      (
        await db.query<LabTest>(
          `SELECT ${testSelect} FROM lab_tests t
 JOIN lab_test_categories c ON c.organization_id=t.organization_id AND c.id=t.category_id
 LEFT JOIN lab_units u ON u.organization_id=t.organization_id AND u.id=t.unit_id
 WHERE t.organization_id=$1 AND t.id=$2 FOR UPDATE OF t`,
          [principal.organizationId, testId],
        )
      ).rows[0] ?? notFound();
    const id = await insertRange(
      db,
      principal,
      test,
      parsed.data.data,
      null,
      1,
    );
    return getOwnedRange(db, principal, testId, id);
  });
}
export async function retireRange(
  db: QueryRunner,
  principal: Principal,
  testId: string,
  rangeId: string,
  input: unknown,
): Promise<LabRange> {
  permit(principal, 'tests:edit');
  permit(principal, 'tests:read');
  const parsed = retireRangeSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    await lockOrganization(db, principal);
    const existing = await getOwnedRange(
      db,
      principal,
      testId,
      rangeId,
      true,
    );
    if (!existing.is_active)
      throw new CatalogueError(
        409,
        'ALREADY_RETIRED',
        'This reference range is already retired.',
      );
    if (Number(existing.version) !== parsed.data.version)
      throw new CatalogueError(
        409,
        'STALE_VERSION',
        'This range changed while you were editing. Reload before continuing.',
      );
    await db.query(
      `UPDATE lab_reference_ranges SET is_active=false,valid_to=GREATEST(now(),valid_from),
 retired_at=now(),retired_by=$3,version=version+1
 WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, rangeId, principal.userId],
    );
    await audit(
      db,
      principal,
      'LAB_REFERENCE_RANGE',
      rangeId,
      'REFERENCE_RANGE_RETIRED',
      { fields: ['is_active', 'valid_to'], test_id: testId },
    );
    return getOwnedRange(db, principal, testId, rangeId);
  });
}
export async function replaceRange(
  db: QueryRunner,
  principal: Principal,
  testId: string,
  rangeId: string,
  input: unknown,
): Promise<{ previous: LabRange; current: LabRange }> {
  permit(principal, 'tests:edit');
  permit(principal, 'tests:read');
  const parsed = replaceRangeSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    await lockOrganization(db, principal);
    const existing = await getOwnedRange(
      db,
      principal,
      testId,
      rangeId,
      true,
    );
    if (!existing.is_active)
      throw new CatalogueError(
        409,
        'ALREADY_RETIRED',
        'Retired ranges cannot be replaced. Create a new range instead.',
      );
    if (Number(existing.version) !== parsed.data.version)
      throw new CatalogueError(
        409,
        'STALE_VERSION',
        'This range changed while you were editing. Reload before continuing.',
      );
    const test = await getTest(db, principal, testId);
    const successorId = await insertRange(
      db,
      principal,
      test,
      parsed.data.data,
      rangeId,
      Number(existing.range_version) + 1,
    );
    await db.query(
      `UPDATE lab_reference_ranges SET is_active=false,
 valid_to=GREATEST(now(),valid_from),successor_id=$4,retired_at=now(),retired_by=$3,version=version+1
 WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, rangeId, principal.userId, successorId],
    );
    await audit(
      db,
      principal,
      'LAB_REFERENCE_RANGE',
      rangeId,
      'REFERENCE_RANGE_REPLACED',
      { fields: ['successor_id', 'valid_to'], successor_id: successorId, test_id: testId },
    );
    return {
      previous: await getOwnedRange(db, principal, testId, rangeId),
      current: await getOwnedRange(db, principal, testId, successorId),
    };
  });
}
export async function rangeById(
  db: QueryRunner,
  principal: Principal,
  rangeId: string,
): Promise<LabRange> {
  permit(principal, 'tests:read');
  const row = (
    await db.query<LabRange>(
      `SELECT ${rangeSelect} FROM lab_reference_ranges r
 LEFT JOIN lab_units u ON u.organization_id=r.organization_id AND u.id=r.unit_id
 WHERE r.organization_id=$1 AND r.id=$2`,
      [principal.organizationId, idValue(rangeId, 'Reference range')],
    )
  ).rows[0];
  return row ?? notFound('Reference range');
}
