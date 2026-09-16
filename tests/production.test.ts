import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { parseEnvironment, isPlaceholderSecret } from '../lib/env';
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
    SMTP_URL: 'smtps://mailer:hunter2@smtp.internal:465',
    SMTP_PASSWORD: 'hunter2',
    cookie: 'medisoft_session=abc',
    token: 'raw-share-token',
    note: 'ordinary',
  }) as Record<string, unknown>;
  assert.equal(hidden.DATABASE_URL, '[redacted]');
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

void test('migrations 001 through 010 apply in order on an empty engine', async () => {
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
 AND relname IN ('organizations','patients','lab_orders','lab_results','lab_reports','lab_invoices','lab_invoice_payment_reversals','lab_credit_notes','clinical_doctors','clinical_prescriptions')
 ORDER BY relname`,
    );
    assert.equal(tables.rows.length, 10);
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
