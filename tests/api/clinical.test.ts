import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { emptyPatient } from '../../features/patients/validation';
import { createPatient } from '../../features/patients/repository';
import { createDoctor } from '../../features/clinical/doctors';
import type { Principal } from '../../lib/auth/permissions';
import type { ClinicalPrescription } from '../../features/clinical/types';

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

const doctorsRoute = await import('../../app/api/clinical-doctors/route');
const doctorDetailRoute = await import('../../app/api/clinical-doctors/[id]/route');
const prescriptionsRoute = await import('../../app/api/clinical-prescriptions/route');
const prescriptionDetailRoute = await import(
  '../../app/api/clinical-prescriptions/[id]/route'
);
const finalizeRoute = await import(
  '../../app/api/clinical-prescriptions/[id]/finalize/route'
);
const pdfRoute = await import('../../app/api/clinical-prescriptions/[id]/pdf/route');
const brandingRoute = await import('../../app/api/organization/branding/route');

function request(
  method: string,
  body?: unknown,
  origin = 'https://clinic.example',
  url = 'https://clinic.example/api/clinical',
) {
  return new Request(url, {
    method,
    headers: { origin, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

void test('clinical APIs enforce origin, tenant scope and finalize permissions', async () => {
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
    const extras: { patient: string; doctor: string }[] = [];
    for (const slug of ['rx-a', 'rx-b']) {
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
      const staff = (
        await db.query<{ id: string }>(
          "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Doctor',$2,'unused','DOCTOR') RETURNING id",
          [org, `${slug}-doc@example.test`],
        )
      ).rows[0];
      const doctor = await createDoctor(db, current, {
        user_id: staff.id,
        first_name: 'Elena',
        last_name: 'Hoxha',
        display_name: 'Dr Elena Hoxha',
        specialty: 'Internal medicine',
        license_number: 'LIC-1',
      });
      extras.push({ patient: patient.id, doctor: doctor.id });
    }
    principal = users[0];
    const forged = await prescriptionsRoute.POST(
      request(
        'POST',
        {
          patient_id: extras[0].patient,
          doctor_id: extras[0].doctor,
          items: [{ medication_name: 'Amoxicillin' }],
        },
        'https://evil.example',
      ),
    );
    assert.equal(forged.status, 403);
    const created = await prescriptionsRoute.POST(
      request('POST', {
        patient_id: extras[0].patient,
        doctor_id: extras[0].doctor,
        items: [{ medication_name: 'Amoxicillin', strength: '500 mg' }],
      }),
    );
    assert.equal(created.status, 200);
    const prescription = (await created.json()) as ClinicalPrescription;
    principal = { ...users[0], role: 'RECEPTIONIST' };
    const denied = await finalizeRoute.POST(
      request('POST', { version: prescription.version }),
      { params: Promise.resolve({ id: prescription.id }) },
    );
    assert.equal(denied.status, 403);
    principal = users[0];
    const finalized = await finalizeRoute.POST(
      request('POST', { version: prescription.version }),
      { params: Promise.resolve({ id: prescription.id }) },
    );
    assert.equal(finalized.status, 200);
    const issued = (await finalized.json()) as ClinicalPrescription;
    principal = users[1];
    const hidden = await prescriptionDetailRoute.GET(request('GET'), {
      params: Promise.resolve({ id: issued.id }),
    });
    assert.equal(hidden.status, 404);
    const hiddenPdf = await pdfRoute.GET(request('GET'), {
      params: Promise.resolve({ id: issued.id }),
    });
    assert.equal(hiddenPdf.status, 404);
    const hiddenDoctor = await doctorDetailRoute.GET(request('GET'), {
      params: Promise.resolve({ id: extras[0].doctor }),
    });
    assert.equal(hiddenDoctor.status, 404);
    principal = users[0];
    const pdf = await pdfRoute.GET(request('GET'), {
      params: Promise.resolve({ id: issued.id }),
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.match(pdf.headers.get('content-disposition') || '', /^attachment;/);
    const preview = await pdfRoute.GET(
      request(
        'GET',
        undefined,
        'https://clinic.example',
        'https://clinic.example/api/clinical-prescriptions/pdf?mode=preview',
      ),
      { params: Promise.resolve({ id: issued.id }) },
    );
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-disposition') || '', /^inline;/);
    const branding = await brandingRoute.PATCH(
      request('PATCH', { legal_name: 'Care Centre', city: 'Tirana' }),
    );
    assert.equal(branding.status, 200);
    principal = { ...users[0], role: 'DOCTOR' };
    const doctorBranding = await brandingRoute.PATCH(
      request('PATCH', { legal_name: 'Doctor cannot write branding' }),
    );
    assert.equal(doctorBranding.status, 403);
    principal = users[1];
    const otherBranding = await brandingRoute.GET(request('GET'));
    const body = (await otherBranding.json()) as { legal_name: string };
    assert.notEqual(body.legal_name, 'Care Centre');
    assert.equal(doctorsRoute.DELETE().status, 405);
    assert.equal(prescriptionsRoute.DELETE().status, 405);
  } finally {
    await db.close();
  }
});
