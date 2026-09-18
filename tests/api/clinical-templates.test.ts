import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { emptyPatient } from '../../features/patients/validation';
import { createPatient } from '../../features/patients/repository';
import { createDoctor } from '../../features/clinical/doctors';
import type { Principal } from '../../lib/auth/permissions';
import type {
  ClinicalPrescription,
  PrescriptionTemplate,
} from '../../features/clinical/types';

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

const templatesRoute = await import('../../app/api/prescription-templates/route');
const templateSearchRoute = await import(
  '../../app/api/prescription-templates/search/route'
);
const templateDetailRoute = await import(
  '../../app/api/prescription-templates/[id]/route'
);
const duplicateRoute = await import(
  '../../app/api/prescription-templates/[id]/duplicate/route'
);
const applyRoute = await import(
  '../../app/api/clinical-prescriptions/[id]/apply-template/route'
);
const prescriptionsRoute = await import(
  '../../app/api/clinical-prescriptions/route'
);

function request(
  method: string,
  body?: unknown,
  origin = 'https://clinic.example',
) {
  return new Request('https://clinic.example/api/clinical', {
    method,
    headers: { origin, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

void test('template APIs enforce origin, tenant scope and draft-only apply', async () => {
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
      '011_prescription_templates.sql',
    ])
      await db.exec(
        await readFile(
          new URL(`../../db/migrations/${migration}`, import.meta.url),
          'utf8',
        ),
      );
    const users: Principal[] = [];
    const extras: { patient: string; doctor: string }[] = [];
    for (const slug of ['tpl-a', 'tpl-b']) {
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
    const forged = await templatesRoute.POST(
      request(
        'POST',
        { name: 'Acute Tonsillitis', items: [{ medication_name: 'Amoxicillin' }] },
        'https://evil.example',
      ),
    );
    assert.equal(forged.status, 403);
    const created = await templatesRoute.POST(
      request('POST', {
        name: 'Acute Tonsillitis',
        category: 'ENT',
        items: [
          { medication_name: 'Amoxicillin', strength: '500 mg' },
          { medication_name: 'Paracetamol', strength: '500 mg' },
        ],
      }),
    );
    assert.equal(created.status, 200);
    const template = (await created.json()) as PrescriptionTemplate;
    assert.equal(template.items.length, 2);
    principal = { ...users[0], role: 'DOCTOR' };
    const doctorCreate = await templatesRoute.POST(
      request('POST', { name: 'Doctor pack', items: [{ medication_name: 'X' }] }),
    );
    assert.equal(doctorCreate.status, 403);
    principal = users[0];
    const copy = await duplicateRoute.POST(request('POST'), {
      params: Promise.resolve({ id: template.id }),
    });
    assert.equal(copy.status, 200);
    const duplicated = (await copy.json()) as PrescriptionTemplate;
    assert.equal(duplicated.name, 'Acute Tonsillitis (copy)');
    const rx = await prescriptionsRoute.POST(
      request('POST', {
        patient_id: extras[0].patient,
        doctor_id: extras[0].doctor,
        items: [],
      }),
    );
    assert.equal(rx.status, 200);
    const draft = (await rx.json()) as ClinicalPrescription;
    const applied = await applyRoute.POST(
      request('POST', { template_id: template.id, version: draft.version }),
      { params: Promise.resolve({ id: draft.id }) },
    );
    assert.equal(applied.status, 200);
    const populated = (await applied.json()) as ClinicalPrescription;
    assert.equal(populated.items.length, 2);
    assert.equal(populated.source_template_id, template.id);
    principal = users[1];
    const hidden = await templateDetailRoute.GET(request('GET'), {
      params: Promise.resolve({ id: template.id }),
    });
    assert.equal(hidden.status, 404);
    const hiddenApply = await applyRoute.POST(
      request('POST', { template_id: template.id, version: 1 }),
      { params: Promise.resolve({ id: draft.id }) },
    );
    assert.equal(hiddenApply.status, 404);
    principal = users[0];
    const listed = await templateSearchRoute.POST(
      request('POST', { query: 'Tonsillitis' }),
    );
    assert.equal(listed.status, 200);
    assert.equal(templatesRoute.DELETE().status, 405);
    const removed = await templateDetailRoute.DELETE(request('DELETE'), {
      params: Promise.resolve({ id: duplicated.id }),
    });
    assert.equal(removed.status, 200);
  } finally {
    await db.close();
  }
});
