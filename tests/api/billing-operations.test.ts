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
import type { LabCreditNote, LabInvoice } from '../../features/billing/types';
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
const orderInvoicesRoute =
  await import('../../app/api/lab-orders/[id]/invoices/route');
const issueRoute = await import('../../app/api/lab-invoices/[id]/issue/route');
const paymentsRoute =
  await import('../../app/api/lab-invoices/[id]/payments/route');
const reverseRoute =
  await import('../../app/api/lab-invoice-payments/[id]/reverse/route');
const receiptRoute =
  await import('../../app/api/lab-invoice-payments/[id]/receipt/route');
const creditNotesRoute =
  await import('../../app/api/lab-invoices/[id]/credit-notes/route');
const issueCreditRoute =
  await import('../../app/api/lab-credit-notes/[id]/issue/route');
const creditNoteRoute = await import('../../app/api/lab-credit-notes/[id]/route');
const emailRoute = await import('../../app/api/lab-invoices/[id]/email/route');
const settingsRoute = await import('../../app/api/organization/billing/route');
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
void test('billing operations APIs enforce correction permissions and tenant 404s', async () => {
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
      '009_billing_operations.sql',
    ])
      await db.exec(
        await readFile(
          new URL(`../../db/migrations/${migration}`, import.meta.url),
          'utf8',
        ),
      );
    const users: Principal[] = [];
    const extras: { patient: string; glu: string }[] = [];
    for (const slug of ['ops-api-a', 'ops-api-b']) {
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
    const orderContext = { params: Promise.resolve({ id: created.id }) };
    const drafted = await orderInvoicesRoute.POST(request('POST', {}), orderContext);
    const draft = (await drafted.json()) as LabInvoice;
    const issuedResponse = await issueRoute.POST(
      request('POST', { version: draft.version }),
      { params: Promise.resolve({ id: draft.id }) },
    );
    const issued = (await issuedResponse.json()) as LabInvoice;
    const paidResponse = await paymentsRoute.POST(
      request('POST', {
        amount: '8.00',
        method: 'CASH',
        reference: 'desk',
        notes: '',
        version: issued.version,
      }),
      { params: Promise.resolve({ id: issued.id }) },
    );
    const paid = (await paidResponse.json()) as LabInvoice;
    assert.equal(paid.status, 'PAID');
    const payment = (
      await db.query<{ id: string }>(
        'SELECT id FROM lab_invoice_payments WHERE invoice_id=$1',
        [issued.id],
      )
    ).rows[0];
    principal = { ...users[0], role: 'RECEPTIONIST' };
    assert.equal(
      (
        await reverseRoute.POST(
          request('POST', {
            amount: '3.00',
            reason: 'Front desk',
            version: paid.version,
          }),
          { params: Promise.resolve({ id: payment.id }) },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await creditNotesRoute.POST(
          request('POST', {
            amount: '1.00',
            reason: 'No',
            notes: '',
            version: paid.version,
          }),
          { params: Promise.resolve({ id: issued.id }) },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await settingsRoute.PATCH(
          request('PATCH', { currency: 'USD', default_tax_rate: '5.00' }),
        )
      ).status,
      403,
    );
    const emailed = await emailRoute.POST(
      request('POST', {
        recipient: 'accounts@example.test',
        version: paid.version,
      }),
      { params: Promise.resolve({ id: issued.id }) },
    );
    assert.equal(emailed.status, 200);
    principal = users[0];
    const reversed = await reverseRoute.POST(
      request('POST', {
        amount: '3.00',
        reason: 'Partial reversal',
        version: paid.version,
      }),
      { params: Promise.resolve({ id: payment.id }) },
    );
    assert.equal(reversed.status, 200);
    assert.equal(((await reversed.json()) as LabInvoice).status, 'PARTIALLY_PAID');
    const receipt = await receiptRoute.GET(request('GET'), {
      params: Promise.resolve({ id: payment.id }),
    });
    assert.equal(receipt.status, 200);
    assert.equal(receipt.headers.get('content-type'), 'application/pdf');
    const noteResponse = await creditNotesRoute.POST(
      request('POST', {
        amount: '2.00',
        reason: 'Courtesy',
        notes: '',
        version: paid.version + 1,
      }),
      { params: Promise.resolve({ id: issued.id }) },
    );
    assert.equal(noteResponse.status, 200);
    const note = (await noteResponse.json()) as LabCreditNote;
    const issuedNote = await issueCreditRoute.POST(
      request('POST', { version: note.version }),
      { params: Promise.resolve({ id: note.id }) },
    );
    assert.equal(issuedNote.status, 200);
    assert.match(
      ((await issuedNote.json()) as LabCreditNote).credit_note_number,
      /^CN-/,
    );
    const settings = await settingsRoute.GET(request('GET'));
    assert.equal(settings.status, 200);
    principal = users[1];
    assert.equal(
      (
        await reverseRoute.POST(
          request('POST', {
            amount: '1.00',
            reason: 'Other clinic',
            version: 1,
          }),
          { params: Promise.resolve({ id: payment.id }) },
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await receiptRoute.GET(request('GET'), {
          params: Promise.resolve({ id: payment.id }),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await creditNoteRoute.GET(request('GET'), {
          params: Promise.resolve({ id: note.id }),
        })
      ).status,
      404,
    );
    assert.equal(reverseRoute.DELETE().status, 405);
    assert.equal(creditNotesRoute.DELETE().status, 405);
    assert.equal(settingsRoute.DELETE().status, 405);
  } finally {
    await db.close();
  }
});
