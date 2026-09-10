import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Principal } from '../../lib/auth/permissions';
import type { LabTest } from '../../features/catalogue/types';
const db = new PGlite();
let principal: Principal | null = null;
mock.module('server-only', { defaultExport: {} });
mock.module('../../lib/auth/session.ts', {
  namedExports: { currentUser: async () => principal },
});
mock.module('../../lib/env.ts', {
  namedExports: {
    environment: () => ({ APP_ORIGIN: 'https://clinic.example' }),
  },
});
mock.module('../../lib/db/index.ts', {
  namedExports: {
    database: () => ({
      query: db.query.bind(db),
      connect: async () => ({ query: db.query.bind(db), release: () => {} }),
    }),
  },
});
const createRoute = await import('../../app/api/tests/route');
const detailRoute = await import('../../app/api/tests/[id]/route');
const searchRoute = await import('../../app/api/tests/search/route');
const rangesRoute = await import('../../app/api/tests/[id]/ranges/route');
const retireRoute =
  await import('../../app/api/tests/[id]/ranges/[rangeId]/retire/route');
function request(
  method: string,
  body?: unknown,
  origin = 'https://clinic.example',
) {
  return new Request('https://clinic.example/api/tests', {
    method,
    headers: { origin, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
void test('authenticated catalogue API enforces origin, tenant scope and permissions', async () => {
  try {
    for (const migration of [
      '001_foundation.sql',
      '002_patient_crm.sql',
      '003_lab_catalogue.sql',
    ])
      await db.exec(
        await readFile(
          new URL(`../../db/migrations/${migration}`, import.meta.url),
          'utf8',
        ),
      );
    const users: Principal[] = [];
    const extras: { category: string; unit: string }[] = [];
    for (const slug of ['api-a', 'api-b']) {
      const org = (
        await db.query<{ id: string }>(
          "INSERT INTO organizations(name,slug,type,country) VALUES($1,$1,'CLINIC','AL') RETURNING id",
          [slug],
        )
      ).rows[0].id;
      const user = (
        await db.query<{ id: string }>(
          "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Synthetic',$2,'unused','ORG_ADMIN') RETURNING id",
          [org, `${slug}@example.test`],
        )
      ).rows[0].id;
      users.push({
        userId: user,
        organizationId: org,
        role: 'ORG_ADMIN',
        name: 'Synthetic',
        organizationName: slug,
        sessionHash: 'test',
      });
      const category = (
        await db.query<{ id: string }>(
          "INSERT INTO lab_test_categories(organization_id,code,name) VALUES($1,'BIOCHEMISTRY','Biochemistry') RETURNING id",
          [org],
        )
      ).rows[0].id;
      const unit = (
        await db.query<{ id: string }>(
          "INSERT INTO lab_units(organization_id,code,symbol,name) VALUES($1,'MG_DL','mg/dL','Milligrams per decilitre') RETURNING id",
          [org],
        )
      ).rows[0].id;
      extras.push({ category, unit });
    }
    principal = users[0];
    const data = {
      code: 'GLU',
      name: 'Glucose',
      short_name: 'Glu',
      category_id: extras[0].category,
      description: '',
      specimen_type: 'SERUM',
      result_type: 'NUMERIC',
      unit_id: extras[0].unit,
      method: 'Hexokinase',
      display_order: 1,
      base_price: '8.00',
      is_active: true,
    };
    assert.equal(
      (
        await createRoute.POST(
          request('POST', { data }, 'https://evil.example'),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await createRoute.POST(
          request('POST', {
            data: { ...data, organization_id: users[1].organizationId },
          }),
        )
      ).status,
      400,
    );
    const created = await createRoute.POST(request('POST', { data }));
    assert.equal(created.status, 200);
    assert.ok(created.headers.get('cache-control')?.includes('no-store'));
    const testRow = (await created.json()) as LabTest;
    const context = { params: Promise.resolve({ id: testRow.id }) };
    assert.equal((await detailRoute.GET(request('GET'), context)).status, 200);
    const range = await rangesRoute.POST(
      request('POST', {
        data: {
          sex: 'ANY',
          lower_bound: '70',
          upper_bound: '99',
          age_min: '18',
          age_max: '120',
        },
      }),
      context,
    );
    assert.equal(range.status, 200);
    const rangeId = ((await range.json()) as { id: string }).id;
    principal = users[1];
    assert.equal((await detailRoute.GET(request('GET'), context)).status, 404);
    assert.equal(
      (
        await detailRoute.PATCH(
          request('PATCH', { data, version: 1 }),
          context,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await rangesRoute.POST(
          request('POST', { data: { lower_bound: '1', upper_bound: '2' } }),
          context,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await retireRoute.POST(request('POST', { version: 1 }), {
          params: Promise.resolve({ id: testRow.id, rangeId }),
        })
      ).status,
      404,
    );
    const search = await searchRoute.POST(request('POST', { query: 'GLU' }));
    assert.equal(((await search.json()) as { total: number }).total, 0);
    principal = { ...users[0], role: 'LAB_TECHNICIAN' };
    assert.equal((await detailRoute.GET(request('GET'), context)).status, 200);
    assert.equal(
      (await createRoute.POST(request('POST', { data: { ...data, code: 'ALT' } }))).status,
      403,
    );
    principal = null;
    assert.equal((await detailRoute.GET(request('GET'), context)).status, 401);
  } finally {
    await db.close();
  }
});
