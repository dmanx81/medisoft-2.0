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
  retireRange,
  updateTest,
} from '../features/catalogue/repository';
import {
  createOrder,
  createSpecimen,
  getOrder,
  placeOrder,
  receiveSpecimen,
} from '../features/orders/repository';
import {
  amendResult,
  enterResult,
  getResultContext,
  listResultHistory,
  listResultsForOrder,
  listResultWork,
  validateResult,
  verifyResult,
} from '../features/results/repository';
import { calculateNumericFlag } from '../features/results/flags';
import { selectReferenceRange } from '../features/results/ranges';
import { ResultError } from '../features/results/types';
import { emptyPatient } from '../features/patients/validation';
import type { Principal, Role } from '../lib/auth/permissions';
async function fixture() {
  const db = new PGlite();
  for (const name of [
    '001_foundation.sql',
    '002_patient_crm.sql',
    '003_lab_catalogue.sql',
    '004_lab_orders_specimens.sql',
    '005_lab_results.sql',
    '006_lab_reports.sql',
  ])
    await db.exec(
      await readFile(
        new URL(`../db/migrations/${name}`, import.meta.url),
        'utf8',
      ),
    );
  const principals: Principal[] = [];
  for (const slug of ['a', 'b']) {
    const org = (
      await db.query<{ id: string }>(
        "INSERT INTO organizations(name,slug,type,country) VALUES($1,$1,'CLINIC','AL') RETURNING id",
        [slug],
      )
    ).rows[0].id;
    const user = (
      await db.query<{ id: string }>(
        "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Test',$2,'unused','ORG_ADMIN') RETURNING id",
        [org, `${slug}@example.test`],
      )
    ).rows[0].id;
    principals.push({
      userId: user,
      organizationId: org,
      name: 'Test',
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
  const patientB = await createPatient(db, b, {
    data: {
      ...emptyPatient,
      first_name: 'Other',
      last_name: 'Clinic',
      date_of_birth: '1990-01-01',
      sex: 'FEMALE',
    },
    acknowledgeDuplicates: true,
  });
  const categoryA = await createCategory(db, a, {
    code: 'BIOCHEMISTRY',
    name: 'Biochemistry',
  });
  const categoryB = await createCategory(db, b, {
    code: 'BIOCHEMISTRY',
    name: 'Biochemistry',
  });
  const unitA = await createUnit(db, a, {
    symbol: 'mg/dL',
    name: 'Milligrams per decilitre',
    code: 'MG_DL',
  });
  const unitB = await createUnit(db, b, {
    symbol: 'mg/dL',
    name: 'Milligrams per decilitre',
    code: 'MG_DL',
  });
  const gluA = await createTest(db, a, testInput(categoryA.id, unitA.id, 'GLU'));
  const gluB = await createTest(db, b, testInput(categoryB.id, unitB.id, 'GLU'));
  const rangeA = await createRange(db, a, gluA.id, rangeInput(unitA.id));
  await createRange(db, b, gluB.id, rangeInput(unitB.id));
  return { db, a, b, patientA, patientB, gluA, gluB, rangeA, unitA, categoryA };
}
const testInput = (
  categoryId: string,
  unitId: string,
  code: string,
  patch: Record<string, unknown> = {},
) => ({
  data: {
    code,
    name: code,
    short_name: code,
    category_id: categoryId,
    description: '',
    specimen_type: 'SERUM',
    result_type: 'NUMERIC',
    unit_id: unitId,
    method: 'Hexokinase',
    display_order: 10,
    base_price: '8.00',
    is_active: true,
    ...patch,
  },
});
const rangeInput = (unitId = '', patch: Record<string, unknown> = {}) => ({
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
    unit_id: unitId,
    method: 'Hexokinase',
    critical_low: '40',
    critical_high: '450',
    valid_from: '',
    ...patch,
  },
});
const hasCode = (code: string) => (error: unknown) =>
  error instanceof ResultError && error.code === code;
async function receivedGlu(
  db: PGlite,
  principal: Principal,
  patientId: string,
  testId: string,
) {
  const created = await createOrder(db, principal, {
    data: {
      patient_id: patientId,
      priority: 'ROUTINE',
      ordering_physician_name: '',
      clinical_notes: '',
      fasting_status: 'UNKNOWN',
      external_reference: '',
      test_ids: [testId],
    },
  });
  const placed = await placeOrder(db, principal, created.id, {
    version: created.version,
  });
  const collected = await createSpecimen(db, principal, placed.id, {
    specimen_type: 'SERUM',
    order_test_ids: [placed.tests[0].id],
    collection_notes: '',
    version: placed.version,
  });
  return receiveSpecimen(db, principal, collected.specimens[0].id, {
    version: collected.specimens[0].version,
  });
}
void test('numeric flags use frozen bounds, operators and critical limits', () => {
  const range = {
    lower_bound: '70',
    upper_bound: '99',
    lower_operator: 'GE',
    upper_operator: 'LE',
    critical_low: '40',
    critical_high: '450',
  };
  assert.equal(calculateNumericFlag(39, range), 'CRITICAL_LOW');
  assert.equal(calculateNumericFlag(40, range), 'CRITICAL_LOW');
  assert.equal(calculateNumericFlag(69, range), 'LOW');
  assert.equal(calculateNumericFlag(70, range), 'NORMAL');
  assert.equal(calculateNumericFlag(85, range), 'NORMAL');
  assert.equal(calculateNumericFlag(99, range), 'NORMAL');
  assert.equal(calculateNumericFlag(100, range), 'HIGH');
  assert.equal(calculateNumericFlag(450, range), 'CRITICAL_HIGH');
  assert.equal(calculateNumericFlag(451, range), 'CRITICAL_HIGH');
  assert.equal(
    calculateNumericFlag(70, { ...range, lower_operator: 'GT' }),
    'LOW',
  );
  assert.equal(
    calculateNumericFlag(99, { ...range, upper_operator: 'LT' }),
    'HIGH',
  );
  assert.equal(calculateNumericFlag(85, null), 'UNINTERPRETED');
  assert.equal(
    calculateNumericFlag(85, {
      lower_bound: '',
      upper_bound: '',
      lower_operator: 'GE',
      upper_operator: 'LE',
      critical_low: '',
      critical_high: '',
    }),
    'UNINTERPRETED',
  );
});
void test('reference range selection is deterministic from existing demographics', () => {
  const base = {
    id: '1',
    sex: 'ANY',
    age_min: '18',
    age_max: '120',
    age_unit: 'YEARS',
    method: '',
    unit_symbol: '',
    is_active: true,
    valid_from: '2020-01-01T00:00:00.000Z',
    valid_to: '',
  };
  const male = { ...base, id: '2', sex: 'MALE' };
  const aged = { ...base, id: '3', age_min: '', age_max: '' };
  assert.equal(
    selectReferenceRange(
      [base, male],
      { sex: 'MALE', date_of_birth: '1990-01-01' },
      '',
      '',
      new Date('2026-01-01T00:00:00.000Z'),
    )?.id,
    '2',
  );
  assert.equal(
    selectReferenceRange(
      [base, male],
      { sex: 'UNKNOWN', date_of_birth: '1990-01-01' },
      '',
      '',
      new Date('2026-01-01T00:00:00.000Z'),
    )?.id,
    '1',
  );
  assert.equal(
    selectReferenceRange(
      [base],
      { sex: 'MALE', date_of_birth: '' },
      '',
      '',
      new Date('2026-01-01T00:00:00.000Z'),
    ),
    null,
  );
  assert.equal(
    selectReferenceRange(
      [aged],
      { sex: 'MALE', date_of_birth: '' },
      '',
      '',
      new Date('2026-01-01T00:00:00.000Z'),
    )?.id,
    '3',
  );
  assert.equal(
    selectReferenceRange(
      [{ ...base, is_active: false }],
      { sex: 'MALE', date_of_birth: '1990-01-01' },
      '',
      '',
      new Date('2026-01-01T00:00:00.000Z'),
    ),
    null,
  );
});
void test('results attach to ordered tests, snapshot ranges and follow audited workflow', async () => {
  const { db, a, b, patientA, gluA, gluB, rangeA, unitA, categoryA } =
    await fixture();
  try {
    const draft = await createOrder(db, a, {
      data: {
        patient_id: patientA.id,
        priority: 'ROUTINE',
        ordering_physician_name: '',
        clinical_notes: '',
        fasting_status: 'UNKNOWN',
        external_reference: '',
        test_ids: [gluA.id],
      },
    });
    await assert.rejects(
      enterResult(db, a, draft.id, draft.tests[0].id, {
        numeric_value: '85',
        version: draft.version,
      }),
      hasCode('INVALID_ORDER_STATUS'),
    );
    const received = await receivedGlu(db, a, patientA.id, gluA.id);
    assert.equal(received.status, 'RECEIVED');
    const testId = received.tests[0].id;
    const context = await getResultContext(db, a, received.id, testId);
    assert.equal(context.range?.id, rangeA.id);
    const entered = await enterResult(db, a, received.id, testId, {
      numeric_value: '85',
      version: received.version,
    });
    assert.equal(entered.status, 'IN_PROCESS');
    const current = entered.results.find((row) => row.is_current)!;
    assert.equal(current.order_test_id, testId);
    assert.equal(current.numeric_value, '85');
    assert.equal(current.flag, 'NORMAL');
    assert.equal(current.range_lower_snapshot, '70');
    assert.equal(current.range_upper_snapshot, '99');
    assert.equal(current.unit_symbol_snapshot, 'mg/dL');
    assert.equal(current.method_snapshot, 'Hexokinase');
    assert.equal(current.status, 'ENTERED');
    const low = await enterResult(db, a, entered.id, testId, {
      numeric_value: '69',
      version: entered.version,
    });
    assert.equal(low.results.find((row) => row.is_current)!.flag, 'LOW');
    assert.equal(
      low.results.find((row) => row.is_current)!.id,
      current.id,
    );
    await assert.rejects(
      verifyResult(db, a, current.id, { version: Number(current.version) + 1 }),
      hasCode('INVALID_RESULT_TRANSITION'),
    );
    const updated = low.results.find((row) => row.is_current)!;
    const validated = await validateResult(db, a, updated.id, {
      version: Number(updated.version),
    });
    assert.equal(
      validated.results.find((row) => row.is_current)!.status,
      'TECHNICALLY_VALIDATED',
    );
    await assert.rejects(
      enterResult(db, a, validated.id, testId, {
        numeric_value: '80',
        version: validated.version,
      }),
      hasCode('INVALID_RESULT_STATUS'),
    );
    const verifiedRow = validated.results.find((row) => row.is_current)!;
    const verified = await verifyResult(db, a, verifiedRow.id, {
      version: Number(verifiedRow.version),
    });
    const frozen = verified.results.find((row) => row.is_current)!;
    assert.equal(frozen.status, 'CLINICALLY_VERIFIED');
    await assert.rejects(
      enterResult(db, a, verified.id, testId, {
        numeric_value: '80',
        version: verified.version,
      }),
      hasCode('INVALID_RESULT_STATUS'),
    );
    await assert.rejects(
      db.query('UPDATE lab_results SET numeric_value=12 WHERE id=$1', [
        frozen.id,
      ]),
      (error: unknown) =>
        String(error).includes('immutable') ||
        String(error).includes('Finalized'),
    );
    await assert.rejects(
      amendResult(db, a, frozen.id, {
        numeric_value: '88',
        version: Number(frozen.version),
      }),
      hasCode('AMENDMENT_REASON_REQUIRED'),
    );
    const amended = await amendResult(db, a, frozen.id, {
      numeric_value: '88',
      reason: 'Transcription correction',
      version: Number(frozen.version),
    });
    const latest = amended.results.find((row) => row.is_current)!;
    const original = amended.results.find((row) => row.id === frozen.id)!;
    assert.equal(original.status, 'SUPERSEDED');
    assert.equal(original.is_current, false);
    assert.equal(original.numeric_value, '69');
    assert.equal(latest.supersedes_id, original.id);
    assert.equal(latest.amendment_reason, 'Transcription correction');
    assert.equal(latest.status, 'ENTERED');
    assert.equal(latest.flag, 'NORMAL');
    assert.equal(original.successor_id, latest.id);
    await retireRange(db, a, gluA.id, rangeA.id, {
      version: Number(rangeA.version),
    });
    await updateTest(db, a, gluA.id, {
      data: {
        ...testInput(categoryA.id, unitA.id, 'GLU').data,
        method: 'Changed later',
        is_active: true,
      },
      version: Number(gluA.version),
    });
    const afterCatalogue = await listResultsForOrder(db, a, verified.id);
    const historical = afterCatalogue.find((row) => row.id === frozen.id)!;
    const amendedAfter = afterCatalogue.find((row) => row.id === latest.id)!;
    assert.equal(historical.numeric_value, '69');
    assert.equal(historical.flag, 'LOW');
    assert.equal(historical.range_lower_snapshot, '70');
    assert.equal(historical.method_snapshot, 'Hexokinase');
    assert.equal(amendedAfter.flag, 'NORMAL');
    assert.equal(amendedAfter.method_snapshot, 'Hexokinase');
    const history = await listResultHistory(db, a, original.id);
    assert.equal(history.length, 2);
    const work = await listResultWork(db, a, { query: amended.order_number });
    assert.equal(work.total, 1);
    const asRole = (role: Role): Principal => ({ ...a, role });
    await assert.rejects(
      enterResult(db, asRole('DOCTOR'), amended.id, testId, {
        numeric_value: '90',
        version: amended.version,
      }),
      hasCode('FORBIDDEN'),
    );
    await assert.rejects(
      validateResult(db, asRole('RECEPTIONIST'), latest.id, {
        version: Number(latest.version),
      }),
      hasCode('FORBIDDEN'),
    );
    const technician = await validateResult(db, asRole('LAB_TECHNICIAN'), latest.id, {
      version: Number(latest.version),
    });
    const techCurrent = technician.results.find((row) => row.is_current)!;
    await assert.rejects(
      verifyResult(db, asRole('LAB_TECHNICIAN'), techCurrent.id, {
        version: Number(techCurrent.version),
      }),
      hasCode('FORBIDDEN'),
    );
    const hidden = await listResultsForOrder(db, asRole('RECEPTIONIST'), amended.id);
    assert.equal(hidden.length, 0);
    const orderB = await receivedGlu(db, b, (await createPatient(db, b, {
      data: {
        ...emptyPatient,
        first_name: 'Second',
        last_name: 'Patient',
        date_of_birth: '1990-01-01',
        sex: 'FEMALE',
      },
      acknowledgeDuplicates: true,
    })).id, gluB.id);
    await assert.rejects(
      enterResult(db, a, orderB.id, orderB.tests[0].id, {
        numeric_value: '80',
        version: orderB.version,
      }),
      (error: unknown) =>
        error instanceof ResultError && error.status === 404,
    );
    await assert.rejects(
      getResultContext(db, b, received.id, testId),
      (error: unknown) =>
        error instanceof ResultError && error.status === 404,
    );
    const events = (
      await db.query<{ action: string }>(
        "SELECT action FROM audit_events WHERE entity_type IN ('LAB_RESULT','LAB_ORDER') ORDER BY occurred_at,id",
      )
    ).rows.map((row) => row.action);
    for (const action of [
      'LAB_ORDER_IN_PROCESS',
      'RESULT_ENTERED',
      'RESULT_UPDATED',
      'RESULT_TECHNICALLY_VALIDATED',
      'RESULT_CLINICALLY_VERIFIED',
      'RESULT_AMENDED',
    ])
      assert.ok(events.includes(action), action);
    await assert.rejects(
      db.query('DELETE FROM lab_results WHERE id=$1', [latest.id]),
    );
  } finally {
    await db.close();
  }
});
void test('critical flags and missing ranges are explicit', async () => {
  const { db, a, patientA, categoryA, unitA } = await fixture();
  try {
    const test = await createTest(
      db,
      a,
      testInput(categoryA.id, unitA.id, 'NOREF'),
    );
    const received = await receivedGlu(db, a, patientA.id, test.id);
    const entered = await enterResult(db, a, received.id, received.tests[0].id, {
      numeric_value: '12',
      version: received.version,
    });
    const current = entered.results.find((row) => row.is_current)!;
    assert.equal(current.flag, 'UNINTERPRETED');
    assert.equal(current.reference_range_id, '');
    const glu = await createTest(
      db,
      a,
      testInput(categoryA.id, unitA.id, 'GLU2'),
    );
    await createRange(db, a, glu.id, rangeInput(unitA.id));
    const ready = await receivedGlu(db, a, patientA.id, glu.id);
    const critical = await enterResult(db, a, ready.id, ready.tests[0].id, {
      numeric_value: '40',
      version: ready.version,
    });
    assert.equal(
      critical.results.find((row) => row.is_current)!.flag,
      'CRITICAL_LOW',
    );
    const high = await enterResult(db, a, critical.id, ready.tests[0].id, {
      numeric_value: '450',
      version: critical.version,
    });
    assert.equal(
      high.results.find((row) => row.is_current)!.flag,
      'CRITICAL_HIGH',
    );
  } finally {
    await db.close();
  }
});
void test('results cannot be attached to another organization ordered test', async () => {
  const { db, a, b, patientA, gluA, gluB } = await fixture();
  try {
    const orderA = await receivedGlu(db, a, patientA.id, gluA.id);
    const orderB = await receivedGlu(
      db,
      b,
      (
        await createPatient(db, b, {
          data: {
            ...emptyPatient,
            first_name: 'Org',
            last_name: 'Bee',
            date_of_birth: '1990-01-01',
            sex: 'FEMALE',
          },
          acknowledgeDuplicates: true,
        })
      ).id,
      gluB.id,
    );
    await assert.rejects(
      enterResult(db, a, orderA.id, orderB.tests[0].id, {
        numeric_value: '80',
        version: orderA.version,
      }),
      (error: unknown) =>
        error instanceof ResultError && error.status === 404,
    );
    await getOrder(db, a, orderA.id);
  } finally {
    await db.close();
  }
});
