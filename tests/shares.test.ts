import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPatient } from '../features/patients/repository';
import {
  createCategory,
  createRange,
  createTest,
  createUnit,
} from '../features/catalogue/repository';
import {
  createOrder,
  createSpecimen,
  placeOrder,
  receiveSpecimen,
} from '../features/orders/repository';
import {
  amendResult,
  enterResult,
  validateResult,
  verifyResult,
} from '../features/results/repository';
import { generateReport } from '../features/reports/repository';
import {
  createReportShare,
  downloadPublicSharePdf,
  inspectPublicShare,
  listReportShares,
  revokeReportShare,
  shareTokenDigest,
  verifyPublicShare,
} from '../features/reports/shares';
import { ReportError } from '../features/reports/types';
import { emptyPatient } from '../features/patients/validation';
import { digest } from '../lib/auth/password';
import type { Principal, Role } from '../lib/auth/permissions';
import type { QueryRunner } from '../lib/db/query';

async function fixture() {
  const db = new PGlite();
  for (const name of [
    '001_foundation.sql',
    '002_patient_crm.sql',
    '003_lab_catalogue.sql',
    '004_lab_orders_specimens.sql',
    '005_lab_results.sql',
    '006_lab_reports.sql',
    '007_report_sharing.sql',
  ])
    await db.exec(
      await readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8'),
    );
  const principals: Principal[] = [];
  for (const slug of ['share-a', 'share-b']) {
    const org = (
      await db.query<{ id: string }>(
        "INSERT INTO organizations(name,slug,type,country,address) VALUES($1,$1,'CLINIC','AL','1 Lab Street') RETURNING id",
        [slug],
      )
    ).rows[0].id;
    const user = (
      await db.query<{ id: string }>(
        "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Share Admin',$2,'unused','ORG_ADMIN') RETURNING id",
        [org, `${slug}@example.test`],
      )
    ).rows[0].id;
    principals.push({
      userId: user,
      organizationId: org,
      name: 'Share Admin',
      organizationName: slug,
      role: 'ORG_ADMIN',
      sessionHash: 'test-session',
    });
  }
  const [a, b] = principals;
  const patientA = await createPatient(db, a, {
    data: {
      ...emptyPatient,
      first_name: 'John',
      last_name: 'Test',
      date_of_birth: '1990-01-01',
      sex: 'MALE',
    },
    acknowledgeDuplicates: true,
  });
  const category = await createCategory(db, a, {
    code: 'BIOCHEMISTRY',
    name: 'Biochemistry',
  });
  const unit = await createUnit(db, a, {
    symbol: 'mg/dL',
    name: 'Milligrams per decilitre',
    code: 'MG_DL',
  });
  const glu = await createTest(db, a, {
    data: {
      code: 'GLU',
      name: 'GLU',
      short_name: 'GLU',
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
  await createRange(db, a, glu.id, {
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
  return { db, a, b, patientA, glu };
}
async function completedOrder(
  db: PGlite,
  principal: Principal,
  patientId: string,
  testId: string,
) {
  const created = await createOrder(db, principal, {
    data: {
      patient_id: patientId,
      priority: 'ROUTINE',
      ordering_physician_name: 'Dr Example',
      clinical_notes: '',
      fasting_status: 'FASTING',
      external_reference: '',
      test_ids: [testId],
    },
  });
  const placed = await placeOrder(db, principal, created.id, {
    version: created.version,
  });
  const collected = await createSpecimen(db, principal, placed.id, {
    specimen_type: 'SERUM',
    order_test_ids: placed.tests.map((test) => test.id),
    collection_notes: '',
    version: placed.version,
  });
  const received = await receiveSpecimen(db, principal, collected.specimens[0].id, {
    version: collected.specimens[0].version,
  });
  const entered = await enterResult(db, principal, received.id, received.tests[0].id, {
    numeric_value: '85',
    version: received.version,
  });
  const current = entered.results.find((row) => row.is_current)!;
  const validated = await validateResult(db, principal, current.id, {
    version: Number(current.version),
  });
  const ready = validated.results.find((row) => row.is_current)!;
  return verifyResult(db, principal, ready.id, {
    version: Number(ready.version),
  });
}
const asRole = (principal: Principal, role: Role): Principal => ({
  ...principal,
  role,
});
const liveClinical =
  /\b(patients|lab_orders|lab_order_tests|lab_tests|lab_reference_ranges|lab_specimens|lab_specimen_tests|lab_results|lab_units|lab_test_categories)\b/i;
function withoutLiveClinical(db: PGlite): QueryRunner {
  return {
    query(sql, values) {
      if (liveClinical.test(sql))
        throw new Error(`Live clinical table read is not allowed: ${sql}`);
      return db.query(sql, values);
    },
  };
}
function pdfText(buffer: Buffer) {
  const raw = buffer.toString('latin1');
  const parts: string[] = [];
  for (const match of raw.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    if (match[1].length % 2 !== 0) continue;
    parts.push(Buffer.from(match[1], 'hex').toString('latin1'));
  }
  for (const match of raw.matchAll(/\(([^\\()]{1,160})\)/g)) {
    parts.push(match[1]);
  }
  return parts.join('');
}

void test('secure shares bind to one issued version and never persist secrets', async () => {
  const { db, a, b, patientA, glu } = await fixture();
  try {
    const verified = await completedOrder(db, a, patientA.id, glu.id);
    const issued = await generateReport(db, a, verified.id, {});
    const report = issued.reports[0];
    await assert.rejects(
      createReportShare(db, asRole(a, 'DOCTOR'), report.id, {}, 'https://lab.example'),
      (error: unknown) => error instanceof ReportError && error.code === 'FORBIDDEN',
    );
    await assert.rejects(
      createReportShare(db, b, report.id, {}, 'https://lab.example'),
      (error: unknown) => error instanceof ReportError && error.status === 404,
    );
    const created = await createReportShare(
      db,
      a,
      report.id,
      {
        recipient_name: 'Ward clerk',
        recipient_email: 'ward@example.test',
        expires_in: '24h',
      },
      'https://lab.example',
    );
    assert.equal(created.share.report_number, report.report_number);
    assert.equal(created.share.report_version, 1);
    assert.equal(created.share.status, 'ACTIVE');
    assert.equal(created.token.length, 64);
    assert.equal(created.pin.length, 8);
    assert.equal(created.url, `https://lab.example/report-access/${created.token}`);
    const stored = (
      await db.query<{ token_digest: string; pin_hash: string }>(
        'SELECT token_digest,pin_hash FROM lab_report_shares WHERE id=$1',
        [created.share.id],
      )
    ).rows[0];
    assert.equal(stored.token_digest, shareTokenDigest(created.token));
    assert.equal(stored.token_digest, digest(created.token));
    assert.notEqual(stored.pin_hash, created.pin);
    assert.equal(JSON.stringify(stored).includes(created.token), false);
    assert.equal(JSON.stringify(stored).includes(created.pin), false);
    const listed = await listReportShares(db, a, report.id);
    assert.equal(listed.length, 1);
    assert.equal(JSON.stringify(listed).includes(created.token), false);
    assert.equal(JSON.stringify(listed).includes(created.pin), false);
    await assert.rejects(
      db.query('DELETE FROM lab_report_shares WHERE id=$1', [created.share.id]),
      (error: unknown) => String(error).includes('not deleted'),
    );
    const inspection = await inspectPublicShare(db, created.token);
    assert.equal(inspection.status, 'verify');
    await assert.rejects(
      verifyPublicShare(db, created.token, { pin: '00000000' }),
      (error: unknown) =>
        error instanceof ReportError && error.code === 'SHARE_PIN_INVALID',
    );
    const verifiedShare = await verifyPublicShare(db, created.token, {
      pin: created.pin,
    });
    assert.equal(verifiedShare.view.patient_name, 'John Test');
    assert.equal(verifiedShare.view.report_number, report.report_number);
    const ready = await inspectPublicShare(
      db,
      created.token,
      verifiedShare.sessionToken,
    );
    assert.equal(ready.status, 'ready');
    const pdf = await downloadPublicSharePdf(
      withoutLiveClinical(db),
      created.token,
      verifiedShare.sessionToken,
    );
    assert.equal(pdf.pdf.subarray(0, 4).toString(), '%PDF');
    assert.equal(pdf.filename, `${report.report_number}.pdf`);
    await db.query("UPDATE patients SET first_name='ChangedLive' WHERE id=$1", [
      patientA.id,
    ]);
    const afterRename = await inspectPublicShare(
      db,
      created.token,
      verifiedShare.sessionToken,
    );
    assert.equal(afterRename.view?.patient_name, 'John Test');
    const current = issued.results.find((row) => row.is_current)!;
    const amended = await amendResult(db, a, current.id, {
      numeric_value: '92',
      reason: 'Repeat measurement',
      version: Number(current.version),
    });
    const latest = amended.results.find((row) => row.is_current)!;
    const validated = await validateResult(db, a, latest.id, {
      version: Number(latest.version),
    });
    const readyResult = validated.results.find((row) => row.is_current)!;
    const recompleted = await verifyResult(db, a, readyResult.id, {
      version: Number(readyResult.version),
    });
    const v2 = await generateReport(db, a, recompleted.id, {});
    assert.equal(v2.reports.length, 2);
    const stillR1 = await inspectPublicShare(
      db,
      created.token,
      verifiedShare.sessionToken,
    );
    assert.equal(stillR1.view?.report_version, 1);
    assert.equal(stillR1.view?.report_number, report.report_number);
    const revoked = await revokeReportShare(db, a, created.share.id);
    assert.equal(revoked.status, 'REVOKED');
    const afterRevoke = await inspectPublicShare(
      db,
      created.token,
      verifiedShare.sessionToken,
    );
    assert.equal(afterRevoke.status, 'unavailable');
    await assert.rejects(
      downloadPublicSharePdf(db, created.token, verifiedShare.sessionToken),
      (error: unknown) =>
        error instanceof ReportError && error.code === 'SHARE_UNAVAILABLE',
    );
    const v2Report = v2.reports.find((row) => row.is_current)!;
    const second = await createReportShare(
      db,
      a,
      v2Report.id,
      { expires_in: '7d' },
      'https://lab.example',
    );
    assert.equal(second.share.report_version, 2);
    await db.query(
      "UPDATE lab_report_shares SET expires_at=now()-interval '1 hour' WHERE id=$1",
      [second.share.id],
    );
    const expired = await inspectPublicShare(db, second.token);
    assert.equal(expired.status, 'unavailable');
    await assert.rejects(
      db.query('UPDATE lab_report_shares SET token_digest=$2 WHERE id=$1', [
        created.share.id,
        'a'.repeat(64),
      ]),
      (error: unknown) => String(error).includes('immutable'),
    );
    const audits = (
      await db.query<{ metadata: string; action: string }>(
        'SELECT action, metadata::text AS metadata FROM audit_events WHERE entity_id=$1',
        [created.share.id],
      )
    ).rows;
    assert.ok(audits.some((row) => row.action === 'LAB_REPORT_SHARE_CREATED'));
    assert.ok(audits.some((row) => row.action === 'LAB_REPORT_SHARE_REVOKED'));
    for (const row of audits) {
      assert.equal(row.metadata.includes(created.token), false);
      assert.equal(row.metadata.includes(created.pin), false);
    }
    const unknown = await inspectPublicShare(db, 'f'.repeat(64));
    assert.equal(unknown.status, 'unavailable');
  } finally {
    await db.close();
  }
});

void test('existing R1 shares are marked superseded after amendment and new stale shares are rejected', async () => {
  const { db, a, patientA, glu } = await fixture();
  try {
    const verified = await completedOrder(db, a, patientA.id, glu.id);
    const issued = await generateReport(db, a, verified.id, {});
    const r1 = issued.reports[0];
    const created = await createReportShare(
      db,
      a,
      r1.id,
      { expires_in: '24h' },
      'https://lab.example',
    );
    const session = await verifyPublicShare(db, created.token, {
      pin: created.pin,
    });
    const current = issued.results.find((row) => row.is_current)!;
    const amended = await amendResult(db, a, current.id, {
      numeric_value: '92',
      reason: 'Repeat measurement',
      version: Number(current.version),
    });
    const afterAmend = await inspectPublicShare(
      db,
      created.token,
      session.sessionToken,
    );
    assert.equal(afterAmend.status, 'ready');
    assert.equal(afterAmend.view?.report_version, 1);
    assert.equal(afterAmend.view?.superseded, true);
    assert.equal(afterAmend.view?.status, 'SUPERSEDED');
    const stalePdf = await downloadPublicSharePdf(
      withoutLiveClinical(db),
      created.token,
      session.sessionToken,
    );
    const staleText = pdfText(stalePdf.pdf);
    assert.ok(staleText.includes('85'));
    assert.equal(staleText.includes('92'), false);
    assert.ok(staleText.includes('no longer the current official report'));
    await assert.rejects(
      createReportShare(db, a, r1.id, {}, 'https://lab.example'),
      (error: unknown) =>
        error instanceof ReportError && error.code === 'REPORT_NOT_CURRENT',
    );
    const latest = amended.results.find((row) => row.is_current)!;
    const validated = await validateResult(db, a, latest.id, {
      version: Number(latest.version),
    });
    const readyResult = validated.results.find((row) => row.is_current)!;
    const recompleted = await verifyResult(db, a, readyResult.id, {
      version: Number(readyResult.version),
    });
    const v2 = await generateReport(db, a, recompleted.id, {});
    const r2 = v2.reports.find((row) => row.is_current)!;
    const historical = await createReportShare(
      db,
      a,
      r1.id,
      { expires_in: '24h' },
      'https://lab.example',
    );
    assert.equal(historical.share.report_version, 1);
    assert.equal(historical.share.report_status, 'SUPERSEDED');
    const currentShare = await createReportShare(
      db,
      a,
      r2.id,
      { expires_in: '24h' },
      'https://lab.example',
    );
    assert.equal(currentShare.share.report_version, 2);
    const currentSession = await verifyPublicShare(db, currentShare.token, {
      pin: currentShare.pin,
    });
    const currentPdf = await downloadPublicSharePdf(
      withoutLiveClinical(db),
      currentShare.token,
      currentSession.sessionToken,
    );
    const currentText = pdfText(currentPdf.pdf);
    assert.ok(currentText.includes('92'));
    assert.equal(
      currentText.includes('no longer the current official report'),
      false,
    );
  } finally {
    await db.close();
  }
});

void test('public PIN verification is rate limited and doctors cannot share', async () => {
  const { db, a, patientA, glu } = await fixture();
  try {
    const verified = await completedOrder(db, a, patientA.id, glu.id);
    const issued = await generateReport(db, a, verified.id, {});
    const created = await createReportShare(
      db,
      a,
      issued.reports[0].id,
      {},
      'https://lab.example',
    );
    for (let i = 0; i < 5; i += 1) {
      await assert.rejects(
        verifyPublicShare(db, created.token, { pin: '11111111' }),
        (error: unknown) =>
          error instanceof ReportError && error.code === 'SHARE_PIN_INVALID',
      );
    }
    await assert.rejects(
      verifyPublicShare(db, created.token, { pin: created.pin }),
      (error: unknown) =>
        error instanceof ReportError && error.code === 'SHARE_RATE_LIMITED',
    );
  } finally {
    await db.close();
  }
});
