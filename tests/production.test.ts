import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { parseEnvironment, isPlaceholderSecret } from '../lib/env';
import {
  AdministrativeDatabaseUrlError,
  administrativeDatabaseUrl,
} from '../lib/db/administrative-url';
import { redact } from '../lib/log';
import {
  applySecurityHeaders,
  contentSecurityPolicy,
} from '../lib/http/security-headers';
import { sessionCookieOptions } from '../lib/http/cookies';
import {
  BillingEmailError,
  DisabledBillingEmailProvider,
  StubBillingEmailProvider,
  billingEmailProvider,
  setBillingEmailProvider,
} from '../features/billing/email';
import { configureEmailProvider } from '../lib/email/configure';
import { SmtpBillingEmailProvider } from '../lib/email/smtp';
import { GET as healthGet, HEAD as healthHead } from '../app/api/health/route';
import type { AppEnvironment } from '../lib/env';

const productionBase = {
  DATABASE_URL:
    'postgresql://medisoft_runtime:n3ver-use-this-in-git@db.internal/medisoft',
  APP_ORIGIN: 'https://app.test',
  NODE_ENV: 'production',
  EMAIL_PROVIDER: 'disabled',
};

void test('production configuration rejects unsafe values without echoing secrets', () => {
  assert.equal(parseEnvironment(productionBase).EMAIL_PROVIDER, 'disabled');
  assert.equal(parseEnvironment(productionBase).DASHBOARD_DEMO, 'false');
  const secretUrl =
    'postgresql://medisoft_runtime:super-secret-db-password@db.internal/medisoft';
  for (const patch of [
    { APP_ORIGIN: 'http://app.test' },
    { APP_ORIGIN: 'https://localhost' },
    { APP_ORIGIN: 'https://lab.local' },
    { DASHBOARD_DEMO: 'true' },
    { EMAIL_PROVIDER: 'stub' },
    { EMAIL_PROVIDER: undefined },
    { DATABASE_URL: 'postgresql://medisoft:replace-with-local-password@db/medisoft' },
    { DATABASE_URL: 'postgresql://medisoft:medisoft_local_dev@db/medisoft' },
    { DATABASE_URL: 'postgresql://medisoft:secret@db/medisoft' },
    { DATABASE_URL: secretUrl.replace('super-secret-db-password', 'password') },
  ]) {
    assert.throws(
      () => parseEnvironment({ ...productionBase, ...patch }),
      (error: unknown) =>
        error instanceof Error &&
        /Invalid server configuration/.test(error.message) &&
        !error.message.includes('super-secret') &&
        !error.message.includes('replace-with-local-password') &&
        !error.message.includes('medisoft_local_dev'),
    );
  }
  assert.throws(
    () => parseEnvironment({ ...productionBase, DATABASE_URL: secretUrl.replace('postgresql', 'mysql') }),
    (error: unknown) =>
      error instanceof Error && !error.message.includes('super-secret-db-password'),
  );
  assert.equal(isPlaceholderSecret('replace-with-local-password'), true);
  const smtp = parseEnvironment({
    ...productionBase,
    EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'smtp.internal',
    SMTP_PORT: '587',
    SMTP_FROM: 'billing@app.test',
    SMTP_USER: 'mailer',
    SMTP_PASSWORD: 'a-long-smtp-credential',
  });
  assert.equal(smtp.EMAIL_PROVIDER, 'smtp');
  assert.throws(() =>
    parseEnvironment({
      ...productionBase,
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'localhost',
      SMTP_FROM: 'billing@app.test',
    }),
  );
});

void test('development still accepts local HTTP origins and the stub mailer', () => {
  const config = parseEnvironment({
    DATABASE_URL: 'postgresql://user:secret@localhost/db',
    APP_ORIGIN: 'http://localhost:3000',
  });
  assert.equal(config.NODE_ENV, 'development');
  assert.equal(config.EMAIL_PROVIDER, 'stub');
  assert.equal(config.APP_ORIGIN, 'http://localhost:3000');
});

void test('logs redact credentials, tokens and connection strings', () => {
  const hidden = redact({
    DATABASE_URL: 'postgresql://user:hunter2@db/medisoft',
    MIGRATION_DATABASE_URL: 'postgresql://owner:hunter2@db/medisoft',
    SMTP_URL: 'smtps://mailer:hunter2@smtp.internal:465',
    SMTP_PASSWORD: 'hunter2',
    cookie: 'medisoft_session=abc',
    token: 'raw-share-token',
    note: 'ordinary',
  }) as Record<string, unknown>;
  assert.equal(hidden.DATABASE_URL, '[redacted]');
  assert.equal(hidden.MIGRATION_DATABASE_URL, '[redacted]');
  assert.equal(hidden.SMTP_URL, '[redacted]');
  assert.equal(hidden.SMTP_PASSWORD, '[redacted]');
  assert.equal(hidden.cookie, '[redacted]');
  assert.equal(hidden.token, '[redacted]');
  assert.equal(hidden.note, 'ordinary');
});

void test('session cookies stay HttpOnly and SameSite=Lax; Secure is production-only', () => {
  const production = sessionCookieOptions(true, 28800);
  const development = sessionCookieOptions(false, 28800);
  assert.equal(production.httpOnly, true);
  assert.equal(production.secure, true);
  assert.equal(production.sameSite, 'lax');
  assert.equal(development.secure, false);
  assert.equal(development.httpOnly, true);
});

void test('security headers cover authenticated paths and withhold HSTS on local HTTP', () => {
  const headers = new Headers();
  applySecurityHeaders('/app/billing', headers, { productionHttps: false });
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(headers.get('X-Frame-Options'), 'DENY');
  assert.equal(headers.get('Content-Security-Policy'), contentSecurityPolicy);
  assert.match(headers.get('Content-Security-Policy') ?? '', /frame-ancestors 'none'/);
  assert.match(headers.get('Permissions-Policy') ?? '', /camera=\(\)/);
  assert.equal(headers.get('Cache-Control'), 'private, no-store');
  assert.equal(headers.get('Strict-Transport-Security'), null);
  const httpsHeaders = new Headers();
  applySecurityHeaders('/app', httpsHeaders, { productionHttps: true });
  assert.equal(
    httpsHeaders.get('Strict-Transport-Security'),
    'max-age=31536000; includeSubDomains',
  );
  const marketing = new Headers();
  applySecurityHeaders('/en', marketing, { productionHttps: false });
  assert.equal(marketing.get('Cache-Control'), null);
});

void test('health endpoint is unauthenticated and does not expose configuration', async () => {
  const response = healthGet();
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(Object.keys(body).join(','), 'status');
  assert.ok(response.headers.get('cache-control')?.includes('no-store'));
  const head = healthHead();
  assert.equal(head.status, 200);
});

void test('email providers distinguish stub, disabled and SMTP failure without leaking secrets', async () => {
  const previous = billingEmailProvider();
  try {
    configureEmailProvider({
      ...productionBase,
      DASHBOARD_DEMO: 'false',
      SMTP_URL: '',
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_SECURE: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      SMTP_FROM: '',
      LOG_LEVEL: 'info',
    } as AppEnvironment);
    await assert.rejects(
      () => billingEmailProvider().send({
        to: 'accounts@example.test',
        subject: 'Invoice',
        text: 'body',
        attachments: [],
      }),
      (error: unknown) =>
        error instanceof BillingEmailError && error.code === 'EMAIL_DISABLED',
    );
    configureEmailProvider({
      ...productionBase,
      NODE_ENV: 'development',
      EMAIL_PROVIDER: 'stub',
      DASHBOARD_DEMO: 'false',
      SMTP_URL: '',
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_SECURE: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      SMTP_FROM: '',
      LOG_LEVEL: 'info',
    } as AppEnvironment);
    assert.equal(billingEmailProvider() instanceof StubBillingEmailProvider, true);
    const smtp = new SmtpBillingEmailProvider({
      ...productionBase,
      EMAIL_PROVIDER: 'smtp',
      DASHBOARD_DEMO: 'false',
      SMTP_URL: '',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1',
      SMTP_SECURE: 'false',
      SMTP_USER: 'mailer',
      SMTP_PASSWORD: 'super-secret-smtp-password',
      SMTP_FROM: 'billing@app.test',
      LOG_LEVEL: 'info',
    } as AppEnvironment);
    await assert.rejects(
      () => smtp.send({
        to: 'accounts@example.test',
        subject: 'Invoice',
        text: 'body',
        attachments: [],
      }),
      (error: unknown) =>
        error instanceof BillingEmailError &&
        error.code === 'EMAIL_UNAVAILABLE' &&
        !error.message.includes('super-secret-smtp-password'),
    );
    assert.equal(new DisabledBillingEmailProvider() instanceof DisabledBillingEmailProvider, true);
  } finally {
    setBillingEmailProvider(previous);
  }
});

void test('migrations 001 through 011 apply in order on an empty engine', async () => {
  const names = (await readdir(new URL('../db/migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  assert.deepEqual(names, [
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
  ]);
  const db = new PGlite();
  try {
    for (const name of names)
      await db.exec(
        await readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8'),
      );
    const tables = await db.query<{ relname: string }>(
      `SELECT relname FROM pg_class
 WHERE relkind='r' AND relnamespace = 'public'::regnamespace
 AND relname IN ('organizations','patients','lab_orders','lab_results','lab_reports','lab_invoices','lab_invoice_payment_reversals','lab_credit_notes','clinical_doctors','clinical_prescriptions','prescription_templates')
 ORDER BY relname`,
    );
    assert.equal(tables.rows.length, 11);
  } finally {
    await db.close();
  }
});

void test('migration 011 upgrades a database already at 010 without changing existing prescriptions', async () => {
  const names = [
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
  ];
  const db = new PGlite();
  try {
    for (const name of names)
      await db.exec(
        await readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8'),
      );
    const org = (
      await db.query<{ id: string }>(
        "INSERT INTO organizations(name,slug,type,country) VALUES('Clinic','upgrade-clinic','CLINIC','AL') RETURNING id",
      )
    ).rows[0].id;
    const user = (
      await db.query<{ id: string }>(
        "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Admin','upgrade@example.test','unused','ORG_ADMIN') RETURNING id",
        [org],
      )
    ).rows[0].id;
    const patient = (
      await db.query<{ id: string }>(
        `INSERT INTO patients(organization_id,patient_number,first_name,last_name,date_of_birth,sex,created_by,updated_by)
 VALUES($1,'PAT-2026-000001','Ada','Patient','1990-01-01','FEMALE',$2,$2) RETURNING id`,
        [org, user],
      )
    ).rows[0].id;
    const doctorUser = (
      await db.query<{ id: string }>(
        "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Doctor','upgrade-doc@example.test','unused','DOCTOR') RETURNING id",
        [org],
      )
    ).rows[0].id;
    const doctor = (
      await db.query<{ id: string }>(
        `INSERT INTO clinical_doctors(organization_id,user_id,first_name,last_name,display_name,created_by,updated_by)
 VALUES($1,$2,'Elena','Hoxha','Dr Elena Hoxha',$3,$3) RETURNING id`,
        [org, doctorUser, user],
      )
    ).rows[0].id;
    const prescription = (
      await db.query<{ id: string; status: string }>(
        `INSERT INTO clinical_prescriptions(organization_id,patient_id,doctor_id,clinical_note,created_by,updated_by)
 VALUES($1,$2,$3,'Pre-011 draft',$4,$4) RETURNING id,status`,
        [org, patient, doctor, user],
      )
    ).rows[0];
    await db.query(
      `INSERT INTO clinical_prescription_items(organization_id,prescription_id,sort_order,medication_name,strength,form,dose,route,frequency,duration,quantity,instructions)
 VALUES($1,$2,1,'Amoxicillin','500 mg','Capsule','1 capsule','Oral','3 times daily','7 days','21 capsules','After food')`,
      [org, prescription.id],
    );
    await db.exec(
      await readFile(
        new URL('../db/migrations/011_prescription_templates.sql', import.meta.url),
        'utf8',
      ),
    );
    const survived = (
      await db.query<{
        id: string;
        status: string;
        clinical_note: string;
        source_template_id: string | null;
      }>(
        `SELECT id,status,clinical_note,source_template_id FROM clinical_prescriptions WHERE id=$1`,
        [prescription.id],
      )
    ).rows[0];
    assert.equal(survived.id, prescription.id);
    assert.equal(survived.status, 'DRAFT');
    assert.equal(survived.clinical_note, 'Pre-011 draft');
    assert.equal(survived.source_template_id, null);
    const items = (
      await db.query<{ medication_name: string }>(
        'SELECT medication_name FROM clinical_prescription_items WHERE prescription_id=$1',
        [prescription.id],
      )
    ).rows;
    assert.equal(items.length, 1);
    assert.equal(items[0].medication_name, 'Amoxicillin');
    const template = (
      await db.query<{ id: string }>(
        `INSERT INTO prescription_templates(organization_id,name,created_by,updated_by)
 VALUES($1,'Acute Tonsillitis',$2,$2) RETURNING id`,
        [org, user],
      )
    ).rows[0];
    await db.query(
      `INSERT INTO prescription_template_items(organization_id,template_id,sort_order,medication_name)
 VALUES($1,$2,1,'Paracetamol')`,
      [org, template.id],
    );
    await assert.rejects(
      db.query(
        `INSERT INTO prescription_templates(organization_id,name,created_by,updated_by)
 VALUES($1,'acute tonsillitis',$2,$2)`,
        [org, user],
      ),
      /duplicate|unique/i,
    );
    await db.query(
      'UPDATE clinical_prescriptions SET source_template_id=$2 WHERE id=$1',
      [prescription.id, template.id],
    );
    await db.query('DELETE FROM prescription_templates WHERE id=$1', [template.id]);
    const remainingItems = (
      await db.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM prescription_template_items WHERE template_id=$1',
        [template.id],
      )
    ).rows[0];
    assert.equal(remainingItems.count, '0');
    const afterDelete = (
      await db.query<{
        source_template_id: string | null;
        status: string;
      }>(
        'SELECT source_template_id,status FROM clinical_prescriptions WHERE id=$1',
        [prescription.id],
      )
    ).rows[0];
    assert.equal(afterDelete.source_template_id, null);
    assert.equal(afterDelete.status, 'DRAFT');
    const identity = (
      await db.query<{ id: string }>(
        `INSERT INTO prescription_templates(organization_id,name,created_by,updated_by)
 VALUES($1,'Identity check',$2,$2) RETURNING id`,
        [org, user],
      )
    ).rows[0];
    await assert.rejects(
      db.query('UPDATE prescription_templates SET created_by=$2 WHERE id=$1', [
        identity.id,
        doctorUser,
      ]),
      /immutable/i,
    );
  } finally {
    await db.close();
  }
});

void test('restore script refuses to run without an explicit confirmation', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/restore.ts'], {
    env: {
      ...process.env,
      CONFIRM_RESTORE: '',
      DATABASE_URL: 'postgresql://operator:super-secret-db-password@localhost/medisoft',
    },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to restore/);
  assert.doesNotMatch(result.stderr, /super-secret-db-password/);
});

void test('administrative scripts prefer MIGRATION_DATABASE_URL and fail closed in production', () => {
  const runtime =
    'postgresql://medisoft_app:super-secret-app-password@127.0.0.1/medisoft_production';
  const owner =
    'postgresql://medisoft_owner:super-secret-owner-password@127.0.0.1/medisoft_production';
  assert.deepEqual(
    administrativeDatabaseUrl({
      NODE_ENV: 'development',
      DATABASE_URL: runtime,
      MIGRATION_DATABASE_URL: owner,
    }),
    { url: owner, source: 'MIGRATION_DATABASE_URL' },
  );
  assert.deepEqual(
    administrativeDatabaseUrl({
      NODE_ENV: 'development',
      DATABASE_URL: runtime,
    }),
    { url: runtime, source: 'DATABASE_URL' },
  );
  assert.deepEqual(
    administrativeDatabaseUrl({
      NODE_ENV: 'production',
      DATABASE_URL: runtime,
      MIGRATION_DATABASE_URL: owner,
    }),
    { url: owner, source: 'MIGRATION_DATABASE_URL' },
  );
  assert.throws(
    () =>
      administrativeDatabaseUrl({
        NODE_ENV: 'production',
        DATABASE_URL: runtime,
      }),
    (error: unknown) =>
      error instanceof AdministrativeDatabaseUrlError &&
      /MIGRATION_DATABASE_URL is required in production/.test(error.message) &&
      !error.message.includes('super-secret-app-password'),
  );
  assert.throws(
    () =>
      administrativeDatabaseUrl({
        NODE_ENV: 'production',
        DATABASE_URL: runtime,
        MIGRATION_DATABASE_URL: '   ',
      }),
    AdministrativeDatabaseUrlError,
  );
  assert.throws(
    () =>
      administrativeDatabaseUrl({
        NODE_ENV: 'production',
        DATABASE_URL: runtime,
        MIGRATION_DATABASE_URL: runtime,
      }),
    (error: unknown) =>
      error instanceof AdministrativeDatabaseUrlError &&
      /must be the schema-owner connection/.test(error.message) &&
      !error.message.includes('super-secret-app-password'),
  );
  assert.throws(
    () =>
      administrativeDatabaseUrl({
        NODE_ENV: 'production',
        MIGRATION_DATABASE_URL:
          'postgresql://medisoft_owner:leaked-owner-secret@',
      }),
    (error: unknown) =>
      error instanceof AdministrativeDatabaseUrlError &&
      !String(error.message).includes('leaked-owner-secret'),
  );
  const appConfig = parseEnvironment({
    ...productionBase,
    DATABASE_URL: runtime,
  });
  assert.equal(appConfig.DATABASE_URL, runtime);
  assert.equal('MIGRATION_DATABASE_URL' in appConfig, false);
  assert.throws(
    () =>
      parseEnvironment({
        ...productionBase,
        MIGRATION_DATABASE_URL:
          'postgresql://medisoft_owner:replace-with-local-password@db.internal/medisoft',
      }),
    (error: unknown) =>
      error instanceof Error &&
      /Invalid server configuration/.test(error.message) &&
      /MIGRATION_DATABASE_URL/.test(error.message) &&
      !error.message.includes('replace-with-local-password'),
  );
});

void test('production migrate refuses DATABASE_URL fallback without leaking credentials', () => {
  const secret = 'super-secret-app-password';
  const env = { ...process.env };
  delete env.MIGRATION_DATABASE_URL;
  env.NODE_ENV = 'production';
  env.DATABASE_URL = `postgresql://medisoft_app:${secret}@127.0.0.1/medisoft_production`;
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/migrate.ts'],
    {
      env,
      encoding: 'utf8',
      timeout: 15000,
    },
  );
  assert.notEqual(result.status, 0);
  const output = `${result.stdout}${result.stderr}`;
  assert.match(output, /MIGRATION_DATABASE_URL/);
  assert.doesNotMatch(output, new RegExp(secret));
  assert.doesNotMatch(output, /medisoft_app/);
});
