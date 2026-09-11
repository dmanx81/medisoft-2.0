import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { emptyPatient } from '../../features/patients/validation';
import { createPatient } from '../../features/patients/repository';
import {
  createCategory,
  createRange,
  createTest,
  createUnit,
} from '../../features/catalogue/repository';
import { createOrder, createSpecimen, placeOrder, receiveSpecimen } from '../../features/orders/repository';
import type { Principal } from '../../lib/auth/permissions';
import type { LabOrder } from '../../features/orders/types';
import type { ResultContext } from '../../features/results/types';
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
const enterRoute =
  await import('../../app/api/lab-orders/[id]/tests/[testId]/results/route');
const contextRoute =
  await import('../../app/api/lab-orders/[id]/tests/[testId]/result-context/route');
const validateRoute = await import('../../app/api/lab-results/[id]/validate/route');
const verifyRoute = await import('../../app/api/lab-results/[id]/verify/route');
const amendRoute = await import('../../app/api/lab-results/[id]/amend/route');
const historyRoute = await import('../../app/api/lab-results/[id]/history/route');
const searchRoute = await import('../../app/api/lab-results/search/route');
const deleteRoute = await import('../../app/api/lab-results/[id]/route');
const orderRoute = await import('../../app/api/lab-orders/[id]/route');
function request(
  method: string,
  body?: unknown,
  origin = 'https://clinic.example',
) {
  return new Request('https://clinic.example/api/lab-results', {
    method,
    headers: { origin, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
void test('result API enforces origin, tenant scope, workflow and permissions', async () => {
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
    const extras: { patient: string; glu: string }[] = [];
    for (const slug of ['res-a', 'res-b']) {
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
        data: {
          ...emptyPatient,
          first_name: slug,
          last_name: 'Patient',
          date_of_birth: '1990-01-01',
          sex: 'MALE',
        },
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
      await createRange(db, current, glu.id, {
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
          unit_id: unit.id,
          method: 'Hexokinase',
          critical_low: '40',
          critical_high: '450',
          valid_from: '',
        },
      });
      extras.push({ patient: patient.id, glu: glu.id });
    }
    principal = users[0];
    const created = await createOrder(db, users[0], {
      data: {
        patient_id: extras[0].patient,
        priority: 'ROUTINE',
        ordering_physician_name: '',
        clinical_notes: '',
        fasting_status: 'UNKNOWN',
        external_reference: '',
        test_ids: [extras[0].glu],
      },
    });
    const placed = await placeOrder(db, users[0], created.id, {
      version: created.version,
    });
    const collected = await createSpecimen(db, users[0], placed.id, {
      specimen_type: 'SERUM',
      order_test_ids: [placed.tests[0].id],
      collection_notes: '',
      version: placed.version,
    });
    const received = await receiveSpecimen(
      db,
      users[0],
      collected.specimens[0].id,
      { version: collected.specimens[0].version },
    );
    const testContext = {
      params: Promise.resolve({
        id: received.id,
        testId: received.tests[0].id,
      }),
    };
    assert.equal(
      (
        await enterRoute.POST(
          request('POST', { numeric_value: '85', version: received.version }, 'https://evil.example'),
          testContext,
        )
      ).status,
      403,
    );
    const entered = await enterRoute.POST(
      request('POST', { numeric_value: '85', version: received.version }),
      testContext,
    );
    assert.equal(entered.status, 200);
    const order = (await entered.json()) as LabOrder;
    assert.equal(order.status, 'IN_PROCESS');
    const result = order.results.find((row) => row.is_current)!;
    assert.equal(result.flag, 'NORMAL');
    const context = await contextRoute.GET(request('GET'), testContext);
    assert.equal(context.status, 200);
    assert.equal(((await context.json()) as ResultContext).current?.id, result.id);
    principal = users[1];
    assert.equal((await enterRoute.POST(
      request('POST', { numeric_value: '90', version: 1 }),
      testContext,
    )).status, 404);
    assert.equal(
      (
        await validateRoute.POST(
          request('POST', { version: result.version }),
          { params: Promise.resolve({ id: result.id }) },
        )
      ).status,
      404,
    );
    const search = await searchRoute.POST(
      request('POST', { query: order.order_number }),
    );
    assert.equal(((await search.json()) as { total: number }).total, 0);
    principal = { ...users[0], role: 'RECEPTIONIST' };
    const shown = await orderRoute.GET(request('GET'), {
      params: Promise.resolve({ id: received.id }),
    });
    assert.equal(shown.status, 200);
    assert.equal(((await shown.json()) as LabOrder).results.length, 0);
    assert.equal(
      (
        await enterRoute.POST(
          request('POST', { numeric_value: '90', version: order.version }),
          testContext,
        )
      ).status,
      403,
    );
    principal = { ...users[0], role: 'LAB_TECHNICIAN' };
    const validated = await validateRoute.POST(
      request('POST', { version: result.version }),
      { params: Promise.resolve({ id: result.id }) },
    );
    assert.equal(validated.status, 200);
    const validatedOrder = (await validated.json()) as LabOrder;
    const validatedResult = validatedOrder.results.find((row) => row.is_current)!;
    assert.equal(
      (
        await verifyRoute.POST(
          request('POST', { version: validatedResult.version }),
          { params: Promise.resolve({ id: validatedResult.id }) },
        )
      ).status,
      403,
    );
    principal = { ...users[0], role: 'BIOCHEMIST' };
    const verified = await verifyRoute.POST(
      request('POST', { version: validatedResult.version }),
      { params: Promise.resolve({ id: validatedResult.id }) },
    );
    assert.equal(verified.status, 200);
    const verifiedOrder = (await verified.json()) as LabOrder;
    const verifiedResult = verifiedOrder.results.find((row) => row.is_current)!;
    principal = { ...users[0], role: 'DOCTOR' };
    assert.equal(
      (
        await amendRoute.POST(
          request('POST', {
            numeric_value: '88',
            reason: 'correction',
            version: verifiedResult.version,
          }),
          { params: Promise.resolve({ id: verifiedResult.id }) },
        )
      ).status,
      403,
    );
    principal = users[0];
    const amended = await amendRoute.POST(
      request('POST', {
        numeric_value: '88',
        reason: 'correction',
        version: verifiedResult.version,
      }),
      { params: Promise.resolve({ id: verifiedResult.id }) },
    );
    assert.equal(amended.status, 200);
    const history = await historyRoute.GET(request('GET'), {
      params: Promise.resolve({ id: verifiedResult.id }),
    });
    assert.equal(history.status, 200);
    assert.equal(((await history.json()) as { id: string }[]).length, 2);
    assert.equal(deleteRoute.DELETE().status, 405);
    principal = null;
    assert.equal(
      (
        await enterRoute.POST(
          request('POST', { numeric_value: '90', version: 1 }),
          testContext,
        )
      ).status,
      401,
    );
  } finally {
    await db.close();
  }
});
