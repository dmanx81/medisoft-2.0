import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { emptyPatient } from '../../features/patients/validation';
import { createPatient } from '../../features/patients/repository';
import {
  createCategory,
  createTest,
  createUnit,
} from '../../features/catalogue/repository';
import type { Principal } from '../../lib/auth/permissions';
import type { LabOrder } from '../../features/orders/types';
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
const createRoute = await import('../../app/api/lab-orders/route');
const searchRoute = await import('../../app/api/lab-orders/search/route');
const detailRoute = await import('../../app/api/lab-orders/[id]/route');
const placeRoute = await import('../../app/api/lab-orders/[id]/place/route');
const cancelRoute = await import('../../app/api/lab-orders/[id]/cancel/route');
const specimenRoute =
  await import('../../app/api/lab-orders/[id]/specimens/route');
const receiveRoute =
  await import('../../app/api/lab-specimens/[id]/receive/route');
const rejectRoute =
  await import('../../app/api/lab-specimens/[id]/reject/route');
function request(
  method: string,
  body?: unknown,
  origin = 'https://clinic.example',
) {
  return new Request('https://clinic.example/api/lab-orders', {
    method,
    headers: { origin, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
void test('authenticated order API enforces origin, tenant scope, transitions and permissions', async () => {
  try {
    for (const migration of [
      '001_foundation.sql',
      '002_patient_crm.sql',
      '003_lab_catalogue.sql',
      '004_lab_orders_specimens.sql',
      '005_lab_results.sql',
    ])
      await db.exec(
        await readFile(
          new URL(`../../db/migrations/${migration}`, import.meta.url),
          'utf8',
        ),
      );
    const users: Principal[] = [];
    const extras: { patient: string; glu: string; cbc: string }[] = [];
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
      const current: Principal = {
        userId: user,
        organizationId: org,
        role: 'ORG_ADMIN',
        name: 'Synthetic',
        organizationName: slug,
        sessionHash: 'test',
      };
      users.push(current);
      principal = current;
      const patient = await createPatient(db, current, {
        data: { ...emptyPatient, first_name: slug, last_name: 'Patient' },
        acknowledgeDuplicates: true,
      });
      const category = await createCategory(db, current, {
        code: 'BIOCHEMISTRY',
        name: 'Biochemistry',
      });
      const unit = await createUnit(db, current, {
        symbol: 'mg/dL',
        name: 'Milligrams per decilitre',
        code: 'MG_DL',
      });
      const glu = await createTest(db, current, {
        data: {
          code: 'GLU',
          name: 'Glucose',
          short_name: 'Glu',
          category_id: category.id,
          description: '',
          specimen_type: 'SERUM',
          result_type: 'NUMERIC',
          unit_id: unit.id,
          method: 'Hexokinase',
          display_order: 1,
          base_price: '8.00',
          is_active: true,
        },
      });
      const cbc = await createTest(db, current, {
        data: {
          code: 'CBC',
          name: 'Complete blood count',
          short_name: 'CBC',
          category_id: category.id,
          description: '',
          specimen_type: 'WHOLE_BLOOD',
          result_type: 'NUMERIC',
          unit_id: unit.id,
          method: 'Automated',
          display_order: 2,
          base_price: '10.00',
          is_active: true,
        },
      });
      extras.push({ patient: patient.id, glu: glu.id, cbc: cbc.id });
    }
    principal = users[0];
    const payload = {
      data: {
        patient_id: extras[0].patient,
        priority: 'ROUTINE',
        ordering_physician_name: '',
        clinical_notes: '',
        fasting_status: 'UNKNOWN',
        external_reference: '',
        test_ids: [extras[0].glu, extras[0].cbc],
      },
    };
    assert.equal(
      (await createRoute.POST(request('POST', payload, 'https://evil.example')))
        .status,
      403,
    );
    assert.equal(
      (
        await createRoute.POST(
          request('POST', {
            data: { ...payload.data, organization_id: users[1].organizationId },
          }),
        )
      ).status,
      400,
    );
    const created = await createRoute.POST(request('POST', payload));
    assert.equal(created.status, 200);
    const order = (await created.json()) as LabOrder;
    assert.match(order.order_number, /^LAB-\d{4}-\d{6}$/);
    const context = { params: Promise.resolve({ id: order.id }) };
    assert.equal((await detailRoute.GET(request('GET'), context)).status, 200);
    assert.equal(
      (
        await detailRoute.PATCH(
          request('PATCH', {
            data: {
              ...payload.data,
              status: 'RECEIVED',
              order_number: 'LAB-2099-000001',
            },
            version: order.version,
          }),
          context,
        )
      ).status,
      400,
    );
    const placed = await placeRoute.POST(
      request('POST', { version: order.version }),
      context,
    );
    assert.equal(placed.status, 200);
    const placedOrder = (await placed.json()) as LabOrder;
    const collected = await specimenRoute.POST(
      request('POST', {
        specimen_type: 'SERUM',
        order_test_ids: [
          placedOrder.tests.find((row) => row.code_snapshot === 'GLU')!.id,
        ],
        collection_notes: '',
        version: placedOrder.version,
      }),
      context,
    );
    assert.equal(collected.status, 200);
    const partial = (await collected.json()) as LabOrder;
    assert.equal(partial.status, 'PARTIALLY_COLLECTED');
    principal = users[1];
    assert.equal((await detailRoute.GET(request('GET'), context)).status, 404);
    assert.equal(
      (
        await placeRoute.POST(
          request('POST', { version: 1 }),
          context,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await specimenRoute.POST(
          request('POST', {
            specimen_type: 'SERUM',
            order_test_ids: [partial.tests[0].id],
            collection_notes: '',
            version: 1,
          }),
          context,
        )
      ).status,
      404,
    );
    const search = await searchRoute.POST(
      request('POST', { query: partial.order_number }),
    );
    assert.equal(((await search.json()) as { total: number }).total, 0);
    const receiveContext = {
      params: Promise.resolve({ id: partial.specimens[0].id }),
    };
    assert.equal(
      (
        await receiveRoute.POST(
          request('POST', { version: partial.specimens[0].version }),
          receiveContext,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await rejectRoute.POST(
          request('POST', {
            version: partial.specimens[0].version,
            reason: 'hemolysed',
          }),
          receiveContext,
        )
      ).status,
      404,
    );
    principal = { ...users[0], role: 'VIEWER' };
    assert.equal((await detailRoute.GET(request('GET'), context)).status, 403);
    principal = { ...users[0], role: 'RECEPTIONIST' };
    assert.equal((await detailRoute.GET(request('GET'), context)).status, 200);
    assert.equal(
      (
        await receiveRoute.POST(
          request('POST', { version: partial.specimens[0].version }),
          receiveContext,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await rejectRoute.POST(
          request('POST', {
            version: partial.specimens[0].version,
            reason: 'hemolysed',
          }),
          receiveContext,
        )
      ).status,
      403,
    );
    principal = { ...users[0], role: 'DOCTOR' };
    assert.equal((await detailRoute.GET(request('GET'), context)).status, 200);
    principal = { ...users[0], role: 'BIOCHEMIST' };
    assert.equal((await detailRoute.GET(request('GET'), context)).status, 200);
    principal = { ...users[0], role: 'LAB_TECHNICIAN' };
    const received = await receiveRoute.POST(
      request('POST', { version: partial.specimens[0].version }),
      receiveContext,
    );
    assert.equal(received.status, 200);
    principal = { ...users[1], role: 'ORG_ADMIN' };
    assert.equal(
      (
        await detailRoute.PATCH(
          request('PATCH', {
            data: {
              patient_id: extras[1].patient,
              priority: 'URGENT',
              ordering_physician_name: '',
              clinical_notes: '',
              fasting_status: 'UNKNOWN',
              external_reference: '',
            },
            version: 1,
          }),
          context,
        )
      ).status,
      404,
    );
    principal = users[0];
    const cancelDraft = await createRoute.POST(
      request('POST', {
        data: { ...payload.data, test_ids: [extras[0].glu] },
      }),
    );
    const draft = (await cancelDraft.json()) as LabOrder;
    assert.equal(
      (
        await cancelRoute.POST(
          request('POST', { version: draft.version }),
          { params: Promise.resolve({ id: draft.id }) },
        )
      ).status,
      400,
    );
    principal = null;
    assert.equal((await detailRoute.GET(request('GET'), context)).status, 401);
  } finally {
    await db.close();
  }
});
