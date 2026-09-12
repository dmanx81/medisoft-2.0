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
import {
  createOrder,
  createSpecimen,
  placeOrder,
  receiveSpecimen,
} from '../../features/orders/repository';
import {
  enterResult,
  validateResult,
  verifyResult,
} from '../../features/results/repository';
import type { Principal } from '../../lib/auth/permissions';
import type { LabOrder } from '../../features/orders/types';
import type { LabReport } from '../../features/reports/types';
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
const contextRoute =
  await import('../../app/api/lab-orders/[id]/report-context/route');
const orderReportsRoute =
  await import('../../app/api/lab-orders/[id]/reports/route');
const reportRoute = await import('../../app/api/lab-reports/[id]/route');
const pdfRoute = await import('../../app/api/lab-reports/[id]/pdf/route');
const deliverRoute = await import('../../app/api/lab-reports/[id]/deliver/route');
const searchRoute = await import('../../app/api/lab-reports/search/route');
function request(
  method: string,
  body?: unknown,
  origin = 'https://clinic.example',
) {
  return new Request('https://clinic.example/api/lab-reports', {
    method,
    headers: { origin, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
void test('report API enforces origin, tenant scope, completeness and permissions', async () => {
  try {
    for (const migration of [
      '001_foundation.sql',
      '002_patient_crm.sql',
      '003_lab_catalogue.sql',
      '004_lab_orders_specimens.sql',
      '005_lab_results.sql',
      '006_lab_reports.sql',
    ])
      await db.exec(
        await readFile(
          new URL(`../../db/migrations/${migration}`, import.meta.url),
          'utf8',
        ),
      );
    const users: Principal[] = [];
    const extras: { patient: string; glu: string }[] = [];
    for (const slug of ['rep-a', 'rep-b']) {
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
          display_order: 10,
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
    const orderContext = { params: Promise.resolve({ id: received.id }) };
    assert.equal(
      (
        await orderReportsRoute.POST(
          request('POST', {}, 'https://evil.example'),
          orderContext,
        )
      ).status,
      403,
    );
    const incomplete = await orderReportsRoute.POST(
      request('POST', {}),
      orderContext,
    );
    assert.equal(incomplete.status, 409);
    assert.equal(((await incomplete.json()) as { code: string }).code, 'ORDER_NOT_COMPLETE');
    const entered = await enterResult(db, users[0], received.id, received.tests[0].id, {
      numeric_value: '85',
      version: received.version,
    });
    const current = entered.results.find((row) => row.is_current)!;
    const validated = await validateResult(db, users[0], current.id, {
      version: Number(current.version),
    });
    const ready = validated.results.find((row) => row.is_current)!;
    const verified = await verifyResult(db, users[0], ready.id, {
      version: Number(ready.version),
    });
    assert.equal(verified.status, 'COMPLETED');
    const generated = await orderReportsRoute.POST(
      request('POST', {}),
      { params: Promise.resolve({ id: verified.id }) },
    );
    assert.equal(generated.status, 200);
    const order = (await generated.json()) as LabOrder;
    const report = order.reports.find((row) => row.is_current)!;
    assert.equal(report.report_version, 1);
    principal = { ...users[0], role: 'DOCTOR' };
    assert.equal(
      (
        await orderReportsRoute.POST(
          request('POST', {}),
          { params: Promise.resolve({ id: verified.id }) },
        )
      ).status,
      403,
    );
    const doctorPdf = await pdfRoute.GET(request('GET'), {
      params: Promise.resolve({ id: report.id }),
    });
    assert.equal(doctorPdf.status, 200);
    assert.equal(doctorPdf.headers.get('content-type'), 'application/pdf');
    principal = users[1];
    assert.equal(
      (
        await reportRoute.GET(request('GET'), {
          params: Promise.resolve({ id: report.id }),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await pdfRoute.GET(request('GET'), {
          params: Promise.resolve({ id: report.id }),
        })
      ).status,
      404,
    );
    principal = { ...users[0], role: 'LAB_TECHNICIAN' };
    assert.equal(
      (
        await pdfRoute.GET(request('GET'), {
          params: Promise.resolve({ id: report.id }),
        })
      ).status,
      403,
    );
    principal = users[0];
    const listed = await orderReportsRoute.GET(request('GET'), {
      params: Promise.resolve({ id: verified.id }),
    });
    assert.equal(((await listed.json()) as LabReport[]).length, 1);
    const context = await contextRoute.GET(request('GET'), {
      params: Promise.resolve({ id: verified.id }),
    });
    assert.equal(((await context.json()) as { eligible: boolean }).eligible, false);
    const delivered = await deliverRoute.POST(
      request('POST', { method: 'MANUAL', recipient_descriptor: 'Clinic desk' }),
      { params: Promise.resolve({ id: report.id }) },
    );
    assert.equal(delivered.status, 200);
    principal = { ...users[0], role: 'DOCTOR' };
    assert.equal(
      (
        await deliverRoute.POST(
          request('POST', { method: 'PRINT' }),
          { params: Promise.resolve({ id: report.id }) },
        )
      ).status,
      403,
    );
    principal = users[0];
    const search = await searchRoute.POST(
      request('POST', { query: order.order_number }),
    );
    assert.equal(((await search.json()) as { total: number }).total, 1);
    assert.equal(orderReportsRoute.DELETE().status, 405);
    assert.equal(reportRoute.DELETE().status, 405);
    principal = null;
    assert.equal(
      (
        await pdfRoute.GET(request('GET'), {
          params: Promise.resolve({ id: report.id }),
        })
      ).status,
      401,
    );
  } finally {
    await db.close();
  }
});
