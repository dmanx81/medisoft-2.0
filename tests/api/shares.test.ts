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
import type { CreatedReportShare, LabReportShare } from '../../features/reports/types';
import { unavailableShareMessage } from '../../features/reports/shares';
const db = new PGlite();
let principal: Principal | null = null;
mock.module('server-only', { defaultExport: {} });
mock.module('../../lib/auth/session.ts', {
  namedExports: { currentUser: async () => principal },
});
mock.module('../../lib/env.ts', {
  namedExports: {
    environment: () => ({
      APP_ORIGIN: 'https://clinic.example',
      NODE_ENV: 'test',
    }),
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
const sharesRoute = await import('../../app/api/lab-reports/[id]/shares/route');
const revokeRoute = await import('../../app/api/lab-report-shares/[id]/revoke/route');
const verifyRoute = await import('../../app/api/public/reports/[token]/verify/route');
const publicPdfRoute = await import('../../app/api/public/reports/[token]/pdf/route');
function request(
  method: string,
  body?: unknown,
  origin = 'https://clinic.example',
  cookie?: string,
) {
  return new Request('https://clinic.example/api/lab-report-shares', {
    method,
    headers: {
      origin,
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
void test('share APIs enforce roles, tenants, secrets and public token safety', async () => {
  try {
    for (const migration of [
      '001_foundation.sql',
      '002_patient_crm.sql',
      '003_lab_catalogue.sql',
      '004_lab_orders_specimens.sql',
      '005_lab_results.sql',
      '006_lab_reports.sql',
      '007_report_sharing.sql',
    ])
      await db.exec(
        await readFile(
          new URL(`../../db/migrations/${migration}`, import.meta.url),
          'utf8',
        ),
      );
    const users: Principal[] = [];
    const extras: { patient: string; glu: string }[] = [];
    for (const slug of ['share-api-a', 'share-api-b']) {
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
    const reportsRoute = await import('../../app/api/lab-orders/[id]/reports/route');
    const generated = await reportsRoute.POST(request('POST', {}), {
      params: Promise.resolve({ id: verified.id }),
    });
    assert.equal(generated.status, 200);
    const reportId = (
      (await generated.json()) as { reports: { id: string; report_number: string }[] }
    ).reports[0].id;
    const reportContext = { params: Promise.resolve({ id: reportId }) };
    principal = { ...users[0], role: 'DOCTOR' };
    assert.equal(
      (await sharesRoute.POST(request('POST', { expires_in: '24h' }), reportContext))
        .status,
      403,
    );
    principal = users[1];
    assert.equal(
      (await sharesRoute.POST(request('POST', { expires_in: '24h' }), reportContext))
        .status,
      404,
    );
    principal = users[0];
    const createdShare = await sharesRoute.POST(
      request('POST', {
        expires_in: '24h',
        recipient_name: 'Ward',
        recipient_email: 'ward@example.test',
      }),
      reportContext,
    );
    assert.equal(createdShare.status, 200);
    const payload = (await createdShare.json()) as CreatedReportShare;
    assert.equal(payload.token.length, 64);
    assert.equal(payload.pin.length, 8);
    assert.equal(payload.url.includes(payload.token), true);
    const listed = await sharesRoute.GET(request('GET'), reportContext);
    const shares = (await listed.json()) as LabReportShare[];
    assert.equal(shares.length, 1);
    assert.equal(JSON.stringify(shares).includes(payload.token), false);
    assert.equal(JSON.stringify(shares).includes(payload.pin), false);
    principal = null;
    assert.equal(
      (await sharesRoute.GET(request('GET'), reportContext)).status,
      401,
    );
    assert.equal(
      (await sharesRoute.POST(request('POST', {}), reportContext)).status,
      401,
    );
    assert.equal(sharesRoute.DELETE().status, 405);
    assert.equal(revokeRoute.DELETE().status, 405);
    assert.equal(verifyRoute.DELETE().status, 405);
    assert.equal(publicPdfRoute.DELETE().status, 405);
    const unknown = await verifyRoute.POST(
      request('POST', { pin: '12345678' }),
      { params: Promise.resolve({ token: 'f'.repeat(64) }) },
    );
    assert.equal(unknown.status, 404);
    const unknownBody = (await unknown.json()) as { code: string; message: string };
    assert.equal(unknownBody.code, 'SHARE_UNAVAILABLE');
    assert.equal(unknownBody.message, unavailableShareMessage);
    const malformed = await publicPdfRoute.GET(request('GET'), {
      params: Promise.resolve({ token: 'not-a-token' }),
    });
    assert.equal(malformed.status, 404);
    assert.equal(
      ((await malformed.json()) as { message: string }).message,
      unavailableShareMessage,
    );
    const pdfLocked = await publicPdfRoute.GET(request('GET'), {
      params: Promise.resolve({ token: payload.token }),
    });
    assert.equal(pdfLocked.status, 404);
    const wrongPin = await verifyRoute.POST(
      request('POST', { pin: '00000000' }),
      { params: Promise.resolve({ token: payload.token }) },
    );
    assert.equal(wrongPin.status, 401);
    assert.equal(
      ((await wrongPin.json()) as { code: string }).code,
      'SHARE_PIN_INVALID',
    );
    const csrf = await verifyRoute.POST(
      request('POST', { pin: payload.pin }, 'https://evil.example'),
      { params: Promise.resolve({ token: payload.token }) },
    );
    assert.equal(csrf.status, 403);
    const verifiedShare = await verifyRoute.POST(
      request('POST', { pin: payload.pin }),
      { params: Promise.resolve({ token: payload.token }) },
    );
    assert.equal(verifiedShare.status, 200);
    const cookie = verifiedShare.headers.get('set-cookie') || '';
    assert.ok(cookie.toLowerCase().includes('httponly'));
    assert.ok(cookie.includes('medisoft_share='));
    assert.equal(cookie.includes(payload.token), false);
    assert.equal(cookie.includes(payload.pin), false);
    const pdf = await publicPdfRoute.GET(
      request('GET', undefined, 'https://clinic.example', cookie.split(';')[0]),
      { params: Promise.resolve({ token: payload.token }) },
    );
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.ok(pdf.headers.get('cache-control')?.includes('no-store'));
    assert.ok(pdf.headers.get('x-robots-tag')?.includes('noindex'));
    const bytes = Buffer.from(await pdf.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    principal = users[0];
    const revoked = await revokeRoute.POST(request('POST', {}), {
      params: Promise.resolve({ id: payload.share.id }),
    });
    assert.equal(revoked.status, 200);
    assert.equal(((await revoked.json()) as LabReportShare).status, 'REVOKED');
    const afterRevoke = await publicPdfRoute.GET(
      request('GET', undefined, 'https://clinic.example', cookie.split(';')[0]),
      { params: Promise.resolve({ token: payload.token }) },
    );
    assert.equal(afterRevoke.status, 404);
    const second = await sharesRoute.POST(
      request('POST', { expires_in: '7d' }),
      reportContext,
    );
    const secondPayload = (await second.json()) as CreatedReportShare;
    await db.query(
      "UPDATE lab_report_shares SET expires_at=now()-interval '1 hour' WHERE id=$1",
      [secondPayload.share.id],
    );
    const expired = await verifyRoute.POST(
      request('POST', { pin: secondPayload.pin }),
      { params: Promise.resolve({ token: secondPayload.token }) },
    );
    assert.equal(expired.status, 404);
    assert.equal(
      ((await expired.json()) as { message: string }).message,
      unavailableShareMessage,
    );
  } finally {
    await db.close();
  }
});
