import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import {
  createCategory,
  createRange,
  createTest,
  createUnit,
  getTest,
  listLookups,
  listRanges,
  listTests,
  rangeById,
  replaceRange,
  retireRange,
  updateTest,
} from '../features/catalogue/repository';
import { catalogueSchema, rangeSchema } from '../features/catalogue/validation';
import { CatalogueError } from '../features/catalogue/types';
import { hashPassword } from '../lib/auth/password';
import type { Principal } from '../lib/auth/permissions';
import { seedCatalogue } from '../scripts/seed-catalogue';
async function fixture() {
  const db = new PGlite();
  for (const name of [
    '001_foundation.sql',
    '002_patient_crm.sql',
    '003_lab_catalogue.sql',
  ])
    await db.exec(
      await readFile(
        new URL(`../db/migrations/${name}`, import.meta.url),
        'utf8',
      ),
    );
  const principals: Principal[] = [];
  for (const slug of ['a', 'b']) {
    const org = (
      await db.query<{ id: string }>(
        "INSERT INTO organizations(name,slug,type,country) VALUES($1,$1,'CLINIC','AL') RETURNING id",
        [slug],
      )
    ).rows[0].id;
    const user = (
      await db.query<{ id: string }>(
        "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Test',$2,'unused','ORG_ADMIN') RETURNING id",
        [org, `${slug}@example.test`],
      )
    ).rows[0].id;
    principals.push({
      userId: user,
      organizationId: org,
      name: 'Test',
      organizationName: slug,
      role: 'ORG_ADMIN',
      sessionHash: 'test-session',
    });
  }
  const categoryA = await createCategory(db, principals[0], {
    code: 'BIOCHEMISTRY',
    name: 'Biochemistry',
  });
  const categoryB = await createCategory(db, principals[1], {
    code: 'BIOCHEMISTRY',
    name: 'Biochemistry',
  });
  const unitA = await createUnit(db, principals[0], {
    symbol: 'mg/dL',
    name: 'Milligrams per decilitre',
    code: 'MG_DL',
  });
  const unitB = await createUnit(db, principals[1], {
    symbol: 'mg/dL',
    name: 'Milligrams per decilitre',
    code: 'MG_DL',
  });
  return {
    db,
    a: principals[0],
    b: principals[1],
    categoryA,
    categoryB,
    unitA,
    unitB,
  };
}
const testInput = (
  categoryId: string,
  unitId: string,
  patch: Record<string, unknown> = {},
) => ({
  data: {
    code: 'GLU',
    name: 'Glucose',
    short_name: 'Glu',
    category_id: categoryId,
    description: '',
    specimen_type: 'SERUM',
    result_type: 'NUMERIC',
    unit_id: unitId,
    method: 'Hexokinase',
    display_order: 10,
    base_price: '8.00',
    is_active: true,
    ...patch,
  },
});
const rangeInput = (patch: Record<string, unknown> = {}) => ({
  data: {
    sex: 'ANY',
    age_min: '18',
    age_max: '120',
    age_unit: 'YEARS',
    lower_bound: '70',
    upper_bound: '99',
    lower_operator: 'GE',
    upper_operator: 'LE',
    text_range: '',
    unit_id: '',
    method: 'Hexokinase',
    critical_low: '40',
    critical_high: '450',
    valid_from: '',
    ...patch,
  },
});
const hasCode = (code: string) => (error: unknown) =>
  error instanceof CatalogueError && error.code === code;
void test('catalogue validation rejects invalid codes, numeric bounds and ages', () => {
  const category = '00000000-0000-4000-8000-000000000001';
  assert.equal(
    catalogueSchema.safeParse(
      testInput(category, category).data,
    ).success,
    true,
  );
  for (const patch of [
    { code: '' },
    { code: 'glu space' },
    { name: '' },
    { organization_id: 'injected' },
    { result_type: 'NUMERIC', unit_id: '' },
    { base_price: '12.345' },
    { result_type: 'PANEL' },
  ])
    assert.equal(
      catalogueSchema.safeParse({
        ...testInput(category, category).data,
        ...patch,
      }).success,
      false,
    );
  assert.equal(rangeSchema.safeParse(rangeInput().data).success, true);
  assert.equal(
    rangeSchema.safeParse(rangeInput({ lower_bound: '120', upper_bound: '70' }).data)
      .success,
    false,
  );
  assert.equal(
    rangeSchema.safeParse(rangeInput({ age_min: '80', age_max: '18' }).data)
      .success,
    false,
  );
  assert.equal(
    rangeSchema.safeParse(rangeInput({ valid_from: 'not-a-date' }).data).success,
    false,
  );
  assert.equal(
    rangeSchema.safeParse(rangeInput({ lower_bound: '', upper_bound: '', text_range: '' }).data)
      .success,
    false,
  );
});
void test('create, read, update, search, category filter and deactivation retain identity', async () => {
  const { db, a, categoryA, unitA } = await fixture();
  try {
    const created = await createTest(
      db,
      a,
      testInput(categoryA.id, unitA.id),
    );
    assert.equal(created.code, 'GLU');
    assert.equal(created.created_by, a.userId);
    assert.equal((await getTest(db, a, created.id)).name, 'Glucose');
    const hormones = await createCategory(db, a, {
      code: 'HORMONES',
      name: 'Hormones',
    });
    const tshUnit = await createUnit(db, a, {
      symbol: 'mIU/L',
      name: 'Milli-international units per litre',
    });
    await createTest(
      db,
      a,
      testInput(hormones.id, tshUnit.id, {
        code: 'TSH',
        name: 'Thyroid stimulating hormone',
        short_name: 'TSH',
      }),
    );
    assert.equal((await listTests(db, a, { query: 'GLU' })).total, 1);
    assert.equal((await listTests(db, a, { query: 'Glucose' })).total, 1);
    assert.equal(
      (await listTests(db, a, { category_id: hormones.id })).total,
      1,
    );
    const updated = await updateTest(db, a, created.id, {
      ...testInput(categoryA.id, unitA.id, { is_active: false, name: 'Glucose fasting' }),
      version: created.version,
    });
    assert.equal(updated.version, 2);
    assert.equal(updated.is_active, false);
    assert.equal(updated.created_by, created.created_by);
    assert.equal((await listTests(db, a, { status: 'ACTIVE' })).total, 1);
    assert.equal((await listTests(db, a, { status: 'INACTIVE' })).total, 1);
    await assert.rejects(
      updateTest(db, a, created.id, {
        ...testInput(categoryA.id, unitA.id),
        version: 1,
      }),
      hasCode('STALE_VERSION'),
    );
    await assert.rejects(
      createTest(db, a, testInput(categoryA.id, unitA.id, { code: 'glu' })),
      hasCode('DUPLICATE_CODE'),
    );
    const events = (
      await db.query<{ action: string; metadata: { fields?: string[] } }>(
        "SELECT action,metadata FROM audit_events WHERE entity_type='LAB_TEST' ORDER BY occurred_at,id",
      )
    ).rows;
    assert.ok(events.some((event) => event.action === 'LAB_TEST_CREATED'));
    assert.ok(events.some((event) => event.action === 'LAB_TEST_UPDATED'));
    assert.ok(events.some((event) => event.action === 'LAB_TEST_STATUS_CHANGED'));
    assert.ok(!JSON.stringify(events).includes('Glucose fasting'));
  } finally {
    await db.close();
  }
});
void test('reference ranges validate, retire and replace without rewriting history', async () => {
  const { db, a, categoryA, unitA } = await fixture();
  try {
    const test = await createTest(db, a, testInput(categoryA.id, unitA.id));
    const created = await createRange(db, a, test.id, rangeInput());
    assert.equal(created.lower_bound, '70');
    assert.equal(created.upper_bound, '99');
    assert.equal(created.is_active, true);
    await assert.rejects(
      createRange(
        db,
        a,
        test.id,
        rangeInput({ lower_bound: '200', upper_bound: '10' }),
      ),
      hasCode('VALIDATION'),
    );
    await assert.rejects(
      createRange(
        db,
        a,
        test.id,
        rangeInput({ age_min: '90', age_max: '10' }),
      ),
      hasCode('VALIDATION'),
    );
    await assert.rejects(
      createRange(
        db,
        a,
        test.id,
        rangeInput({ valid_from: 'not-a-date' }),
      ),
      hasCode('VALIDATION'),
    );
    const replaced = await replaceRange(
      db,
      a,
      test.id,
      created.id,
      rangeInput({ upper_bound: '100', version: undefined }),
    ).catch((error) => error);
    assert.equal(replaced instanceof CatalogueError, true);
    const replacement = await replaceRange(db, a, test.id, created.id, {
      ...rangeInput({ upper_bound: '100' }),
      version: created.version,
    });
    assert.equal(replacement.previous.is_active, false);
    assert.equal(replacement.previous.upper_bound, '99');
    assert.equal(replacement.current.upper_bound, '100');
    assert.equal(replacement.current.range_version, 2);
    assert.equal(replacement.current.supersedes_id, created.id);
    assert.equal(replacement.previous.successor_id, replacement.current.id);
    const historical = await rangeById(db, a, created.id);
    assert.equal(historical.upper_bound, '99');
    assert.equal(historical.is_active, false);
    await assert.rejects(
      db.query('UPDATE lab_reference_ranges SET upper_bound=101 WHERE id=$1', [
        created.id,
      ]),
      /immutable/,
    );
    const current = await retireRange(db, a, test.id, replacement.current.id, {
      version: replacement.current.version,
    });
    assert.equal(current.is_active, false);
    const listed = await listRanges(db, a, test.id);
    assert.equal(listed.length, 2);
    assert.ok(listed.every((range) => range.is_active === false));
    const events = (
      await db.query<{ action: string }>(
        "SELECT action FROM audit_events WHERE entity_type='LAB_REFERENCE_RANGE'",
      )
    ).rows.map((row) => row.action);
    assert.ok(events.includes('REFERENCE_RANGE_CREATED'));
    assert.ok(events.includes('REFERENCE_RANGE_REPLACED'));
    assert.ok(events.includes('REFERENCE_RANGE_RETIRED'));
  } finally {
    await db.close();
  }
});
void test('tenant isolation blocks cross-organization catalogue and range access', async () => {
  const { db, a, b, categoryA, categoryB, unitA, unitB } = await fixture();
  try {
    const testA = await createTest(db, a, testInput(categoryA.id, unitA.id));
    const rangeA = await createRange(db, a, testA.id, rangeInput());
    await assert.rejects(getTest(db, b, testA.id), hasCode('NOT_FOUND'));
    await assert.rejects(
      updateTest(db, b, testA.id, {
        ...testInput(categoryB.id, unitB.id, { is_active: false }),
        version: 1,
      }),
      hasCode('NOT_FOUND'),
    );
    assert.equal((await listTests(db, b, { query: 'GLU' })).total, 0);
    await assert.rejects(
      createRange(db, b, testA.id, rangeInput()),
      hasCode('NOT_FOUND'),
    );
    await assert.rejects(
      retireRange(db, b, testA.id, rangeA.id, { version: 1 }),
      hasCode('NOT_FOUND'),
    );
    await assert.rejects(
      replaceRange(db, b, testA.id, rangeA.id, {
        ...rangeInput(),
        version: 1,
      }),
      hasCode('NOT_FOUND'),
    );
    await assert.rejects(rangeById(db, b, rangeA.id), hasCode('NOT_FOUND'));
    const testB = await createTest(db, b, testInput(categoryB.id, unitB.id));
    assert.equal(testB.code, 'GLU');
    assert.notEqual(testB.id, testA.id);
    await assert.rejects(
      createTest(db, a, {
        data: {
          ...testInput(categoryB.id, unitA.id).data,
          code: 'ALT',
        },
      }),
      hasCode('VALIDATION'),
    );
  } finally {
    await db.close();
  }
});
void test('roles enforce catalogue read and write permissions server-side', async () => {
  const { db, a, categoryA, unitA } = await fixture();
  try {
    const test = await createTest(db, a, testInput(categoryA.id, unitA.id));
    const viewer = { ...a, role: 'VIEWER' as const };
    const technician = { ...a, role: 'LAB_TECHNICIAN' as const };
    const receptionist = { ...a, role: 'RECEPTIONIST' as const };
    const biochemist = { ...a, role: 'BIOCHEMIST' as const };
    await assert.rejects(getTest(db, viewer, test.id), hasCode('FORBIDDEN'));
    assert.equal((await getTest(db, technician, test.id)).id, test.id);
    assert.equal((await listTests(db, receptionist, {})).total, 1);
    await assert.rejects(
      createTest(db, technician, testInput(categoryA.id, unitA.id, { code: 'ALT' })),
      hasCode('FORBIDDEN'),
    );
    await assert.rejects(
      updateTest(db, receptionist, test.id, {
        ...testInput(categoryA.id, unitA.id),
        version: 1,
      }),
      hasCode('FORBIDDEN'),
    );
    const created = await createTest(
      db,
      biochemist,
      testInput(categoryA.id, unitA.id, { code: 'ALT' }),
    );
    assert.equal(created.code, 'ALT');
  } finally {
    await db.close();
  }
});
void test('password hash changes revoke existing sessions and seed remains idempotent', async () => {
  const { db, a, b } = await fixture();
  try {
    await db.query(
      "INSERT INTO sessions(token_hash,organization_id,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      ['a'.repeat(64), a.organizationId, a.userId],
    );
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [
      await hashPassword('Replacement password 2026'),
      a.userId,
    ]);
    assert.equal(
      (
        await db.query('SELECT token_hash FROM sessions WHERE user_id=$1', [
          a.userId,
        ])
      ).rows.length,
      0,
    );
    await db.query('BEGIN');
    await seedCatalogue(db, a.organizationId, a.userId, 1);
    await seedCatalogue(db, b.organizationId, b.userId, 2);
    await db.query('COMMIT');
    assert.equal((await listTests(db, a, {})).total, 4);
    assert.equal((await listTests(db, b, { query: 'GLU' })).total, 1);
    const gluA = (await listTests(db, a, { query: 'GLU' })).tests[0];
    const current = await getTest(db, a, gluA.id);
    await updateTest(db, a, gluA.id, {
      data: {
        code: current.code,
        name: 'Staff edited glucose',
        short_name: current.short_name,
        category_id: current.category_id,
        description: current.description,
        specimen_type: current.specimen_type,
        result_type: current.result_type,
        unit_id: current.unit_id,
        method: current.method,
        display_order: Number(current.display_order),
        base_price: current.base_price,
        is_active: !!current.is_active,
      },
      version: current.version,
    });
    await db.query('BEGIN');
    await seedCatalogue(db, a.organizationId, a.userId, 1);
    await db.query('COMMIT');
    assert.equal((await getTest(db, a, gluA.id)).name, 'Staff edited glucose');
    assert.equal((await listLookups(db, a)).categories.length >= 7, true);
  } finally {
    await db.close();
  }
});
