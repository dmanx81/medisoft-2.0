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
import { createOrder } from '../../features/orders/repository';
import type { Principal } from '../../lib/auth/permissions';
import type { LabInvoice } from '../../features/billing/types';
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
  await import('../../app/api/lab-orders/[id]/invoice-context/route');
const orderInvoicesRoute =
  await import('../../app/api/lab-orders/[id]/invoices/route');
const invoiceRoute = await import('../../app/api/lab-invoices/[id]/route');
const issueRoute = await import('../../app/api/lab-invoices/[id]/issue/route');
const cancelRoute = await import('../../app/api/lab-invoices/[id]/cancel/route');
const pdfRoute = await import('../../app/api/lab-invoices/[id]/pdf/route');
const paymentsRoute =
  await import('../../app/api/lab-invoices/[id]/payments/route');
const searchRoute = await import('../../app/api/lab-invoices/search/route');
function request(
  method: string,
  body?: unknown,
  origin = 'https://clinic.example',
) {
  return new Request('https://clinic.example/api/lab-invoices', {
    method,
    headers: { origin, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
void test('billing API enforces origin, tenant scope, derived payment status and permissions', async () => {
  try {
    for (const migration of [
      '001_foundation.sql',
      '002_patient_crm.sql',
      '003_lab_catalogue.sql',
      '004_lab_orders_specimens.sql',
      '005_lab_results.sql',
      '006_lab_reports.sql',
      '007_report_sharing.sql',
      '008_billing.sql',
    ])
      await db.exec(
        await readFile(
          new URL(`../../db/migrations/${migration}`, import.meta.url),
          'utf8',
        ),
      );
    const users: Principal[] = [];
    const extras: { patient: string; glu: string; alt: string }[] = [];
    for (const slug of ['bill-a', 'bill-b']) {
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
      const alt = await createTest(db, current, {
        data: {
          code: 'ALT',
          name: 'ALT',
          short_name: 'Alt',
          category_id: category.id,
          description: '',
          specimen_type: 'SERUM',
          result_type: 'NUMERIC',
          unit_id: unit.id,
          method: 'Hexokinase',
          display_order: 11,
          base_price: '7.00',
          is_active: true,
        },
      });
      extras.push({ patient: patient.id, glu: glu.id, alt: alt.id });
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
        test_ids: [extras[0].glu, extras[0].alt],
      },
    });
    const orderContext = { params: Promise.resolve({ id: created.id }) };
    assert.equal(
      (
        await orderInvoicesRoute.POST(
          request('POST', {}, 'https://evil.example'),
          orderContext,
        )
      ).status,
      403,
    );
    principal = { ...users[0], role: 'DOCTOR' };
    assert.equal(
      (await orderInvoicesRoute.POST(request('POST', {}), orderContext)).status,
      403,
    );
    principal = { ...users[0], role: 'LAB_TECHNICIAN' };
    assert.equal(
      (await orderInvoicesRoute.POST(request('POST', {}), orderContext)).status,
      403,
    );
    principal = { ...users[0], role: 'BIOCHEMIST' };
    const biochemistRead = await contextRoute.GET(request('GET'), orderContext);
    assert.equal(biochemistRead.status, 200);
    assert.equal(
      (await orderInvoicesRoute.POST(request('POST', {}), orderContext)).status,
      403,
    );
    principal = { ...users[0], role: 'RECEPTIONIST' };
    const drafted = await orderInvoicesRoute.POST(
      request('POST', {}),
      orderContext,
    );
    assert.equal(drafted.status, 200);
    const draft = (await drafted.json()) as LabInvoice;
    assert.equal(draft.status, 'DRAFT');
    assert.equal(
      (
        await orderInvoicesRoute.POST(request('POST', {}), orderContext)
      ).status,
      409,
    );
    const issuedResponse = await issueRoute.POST(
      request('POST', { version: draft.version }),
      { params: Promise.resolve({ id: draft.id }) },
    );
    assert.equal(issuedResponse.status, 200);
    const issued = (await issuedResponse.json()) as LabInvoice;
    assert.equal(issued.status, 'ISSUED');
    assert.match(issued.invoice_number, /^INV-/);
    principal = users[0];
    const cancelledDenied = await cancelRoute.POST(
      request('POST', { reason: 'test', version: issued.version }),
      { params: Promise.resolve({ id: issued.id }) },
    );
    assert.equal(cancelledDenied.status, 200);
    const cancelled = (await cancelledDenied.json()) as LabInvoice;
    assert.equal(cancelled.status, 'CANCELLED');
    const replacement = await orderInvoicesRoute.POST(
      request('POST', {}),
      orderContext,
    );
    assert.equal(replacement.status, 200);
    const replacementDraft = (await replacement.json()) as LabInvoice;
    principal = { ...users[0], role: 'RECEPTIONIST' };
    const issuedResponse2 = await issueRoute.POST(
      request('POST', { version: replacementDraft.version }),
      { params: Promise.resolve({ id: replacementDraft.id }) },
    );
    assert.equal(issuedResponse2.status, 200);
    const issued2 = (await issuedResponse2.json()) as LabInvoice;
    assert.equal(
      (
        await issueRoute.POST(request('POST', { version: issued2.version }), {
          params: Promise.resolve({ id: issued2.id }),
        })
      ).status,
      409,
    );
    const pdf = await pdfRoute.GET(request('GET'), {
      params: Promise.resolve({ id: issued2.id }),
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.ok(pdf.headers.get('cache-control')?.includes('no-store'));
    const partial = await paymentsRoute.POST(
      request('POST', {
        amount: '5.00',
        method: 'CASH',
        reference: 'front-desk',
        notes: '',
        version: issued2.version,
      }),
      { params: Promise.resolve({ id: issued2.id }),
    });
    assert.equal(partial.status, 200);
    assert.equal(((await partial.json()) as LabInvoice).status, 'PARTIALLY_PAID');
    const overpay = await paymentsRoute.POST(
      request('POST', {
        amount: '20.00',
        method: 'CASH',
        reference: '',
        notes: '',
        version: issued2.version + 1,
      }),
      { params: Promise.resolve({ id: issued2.id }),
    });
    assert.equal(overpay.status, 409);
    assert.equal(((await overpay.json()) as { code: string }).code, 'PAYMENT_EXCEEDS_BALANCE');
    principal = users[1];
    assert.equal(
      (
        await invoiceRoute.GET(request('GET'), {
          params: Promise.resolve({ id: issued2.id }),
        })
      ).status,
      404,
    );
    principal = { ...users[0], role: 'RECEPTIONIST' };
    const search = await searchRoute.POST(
      request('POST', { query: issued2.invoice_number }),
    );
    assert.equal(((await search.json()) as { total: number }).total, 1);
    assert.equal(orderInvoicesRoute.DELETE().status, 405);
    assert.equal(invoiceRoute.DELETE().status, 405);
    assert.equal(paymentsRoute.DELETE().status, 405);
    principal = null;
    assert.equal(
      (
        await pdfRoute.GET(request('GET'), {
          params: Promise.resolve({ id: issued2.id }),
        })
      ).status,
      401,
    );
  } finally {
    await db.close();
  }
});
