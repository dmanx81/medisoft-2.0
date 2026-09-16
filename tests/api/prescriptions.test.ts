import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { emptyPatient } from '../../features/patients/validation';
import { createPatient } from '../../features/patients/repository';
import { solidPng } from '../../features/branding/assets';
import type { Principal } from '../../lib/auth/permissions';
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
const doctorsRoute = await import('../../app/api/doctors/route');
const doctorRoute = await import('../../app/api/doctors/[id]/route');
const searchRoute = await import('../../app/api/doctors/search/route');
const brandingRoute = await import('../../app/api/organization/branding/route');
const logoRoute = await import('../../app/api/organization/branding/logo/route');
const patientRxRoute = await import('../../app/api/patients/[id]/prescriptions/route');
const rxRoute = await import('../../app/api/prescriptions/[id]/route');
const finalizeRoute = await import('../../app/api/prescriptions/[id]/finalize/route');
const pdfRoute = await import('../../app/api/prescriptions/[id]/pdf/route');
function request(method: string, body?: unknown, origin = 'https://clinic.example') {
  return new Request('https://clinic.example/api/doctors', {
    method,
    headers: { origin, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
void test('clinical APIs enforce origin, tenant scope, finalize permission and A5 PDFs', async () => {
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
      '010_clinical_prescriptions.sql',
    ])
      await db.exec(
        await readFile(
          new URL(`../../db/migrations/${migration}`, import.meta.url),
          'utf8',
        ),
      );
    const users: Principal[] = [];
    const extras: { patient: string; doctorUser: string }[] = [];
    for (const slug of ['api-a', 'api-b']) {
      const org = (
        await db.query<{ id: string }>(
          "INSERT INTO organizations(name,slug,type,country) VALUES($1,$1,'CLINIC','AL') RETURNING id",
          [slug],
        )
      ).rows[0].id;
      const admin = (
        await db.query<{ id: string }>(
          "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Admin',$2,'unused','ORG_ADMIN') RETURNING id",
          [org, `${slug}@example.test`],
        )
      ).rows[0].id;
      const doctorUser = (
        await db.query<{ id: string }>(
          "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Doctor',$2,'unused','DOCTOR') RETURNING id",
          [org, `${slug}-doc@example.test`],
        )
      ).rows[0].id;
      const current: Principal = {
        userId: admin,
        organizationId: org,
        role: 'ORG_ADMIN',
        name: 'Admin',
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
          date_of_birth: '1991-02-03',
          sex: 'MALE',
        },
        acknowledgeDuplicates: true,
      });
      extras.push({ patient: patient.id, doctorUser });
    }
    principal = users[0];
    const csrf = await doctorsRoute.POST(
      request('POST', { user_id: extras[0].doctorUser, first_name: 'A', last_name: 'B' }, 'https://evil.example'),
    );
    assert.equal(csrf.status, 403);
    const created = await doctorsRoute.POST(
      request('POST', {
        user_id: extras[0].doctorUser,
        first_name: 'Ada',
        last_name: 'Leku',
        specialty: 'GP',
        license_number: 'L-1',
      }),
    );
    assert.equal(created.status, 200);
    const doctor = (await created.json()) as { id: string };
    const list = await searchRoute.POST(request('POST', {}));
    assert.equal(list.status, 200);
    principal = users[1];
    const isolated = await doctorRoute.GET(request('GET'), {
      params: Promise.resolve({ id: doctor.id }),
    });
    assert.equal(isolated.status, 404);
    principal = users[0];
    const branding = await brandingRoute.PATCH(
      request('PATCH', {
        name: 'API Clinic',
        legal_name: 'API Clinic',
        address: '1 Road',
        city: 'Tirana',
        postal_code: '1000',
        country: 'AL',
        phone: '+355',
        email: 'a@example.test',
        website: 'https://api.example',
        registration_number: 'R1',
      }),
    );
    assert.equal(branding.status, 200);
    const logoBytes = await solidPng(80, 40, '#17353A');
    const logo = await logoRoute.PUT(
      new Request('https://clinic.example/api/organization/branding/logo', {
        method: 'PUT',
        headers: { origin: 'https://clinic.example', 'content-type': 'image/png' },
        body: new Uint8Array(logoBytes),
      }),
    );
    assert.equal(logo.status, 200);
    const draft = await patientRxRoute.POST(
      request('POST', {
        doctor_id: doctor.id,
        items: [
          {
            medication_name: 'Amoxicillin',
            strength: '500 mg',
            form: 'Capsule',
            dose: '1',
            route: 'Oral',
            frequency: 'TID',
            duration: '7 days',
            quantity: '21',
            instructions: 'After food',
          },
        ],
      }),
      { params: Promise.resolve({ id: extras[0].patient }) },
    );
    assert.equal(draft.status, 200);
    const prescription = (await draft.json()) as { id: string; version: number };
    principal = { ...users[0], role: 'LAB_TECHNICIAN' };
    const forbidden = await finalizeRoute.POST(
      request('POST', { version: prescription.version }),
      { params: Promise.resolve({ id: prescription.id }) },
    );
    assert.equal(forbidden.status, 403);
    principal = users[0];
    const issued = await finalizeRoute.POST(
      request('POST', { version: prescription.version }),
      { params: Promise.resolve({ id: prescription.id }) },
    );
    assert.equal(issued.status, 200);
    const pdf = await pdfRoute.GET(request('GET'), {
      params: Promise.resolve({ id: prescription.id }),
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    const bytes = Buffer.from(await pdf.arrayBuffer());
    assert.match(bytes.toString('latin1'), /\/MediaBox \[0 0 419\.53 595\.28\]/);
    principal = users[1];
    const otherPdf = await pdfRoute.GET(request('GET'), {
      params: Promise.resolve({ id: prescription.id }),
    });
    assert.equal(otherPdf.status, 404);
    const otherGet = await rxRoute.GET(request('GET'), {
      params: Promise.resolve({ id: prescription.id }),
    });
    assert.equal(otherGet.status, 404);
  } finally {
    await db.close();
  }
});
