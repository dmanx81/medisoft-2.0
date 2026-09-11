import type { QueryRunner } from '../lib/db/query';
const categories = [
  ['HEMATOLOGY', 'Hematology', 10],
  ['BIOCHEMISTRY', 'Biochemistry', 20],
  ['HORMONES', 'Hormones', 30],
  ['IMMUNOLOGY', 'Immunology', 40],
  ['URINALYSIS', 'Urinalysis', 50],
  ['COAGULATION', 'Coagulation', 60],
  ['MICROBIOLOGY', 'Microbiology', 70],
] as const;
const units = [
  ['MG_DL', 'mg/dL', 'Milligrams per decilitre'],
  ['MMOL_L', 'mmol/L', 'Millimoles per litre'],
  ['G_DL', 'g/dL', 'Grams per decilitre'],
  ['U_L', 'U/L', 'Units per litre'],
  ['MIU_L', 'mIU/L', 'Milli-international units per litre'],
  ['PERCENT', '%', 'Percent'],
  ['X10E9_L', 'x10^9/L', 'Times 10^9 per litre'],
  ['MG_L', 'mg/L', 'Milligrams per litre'],
  ['G_L', 'g/L', 'Grams per litre'],
  ['NG_ML', 'ng/mL', 'Nanograms per millilitre'],
] as const;
function id(prefix: string, group: 1 | 2, index: number) {
  return `${prefix}-0000-4000-8000-000000000${group}${String(index).padStart(2, '0')}`;
}
async function owned(
  db: QueryRunner,
  table: string,
  rowId: string,
  organizationId: string,
) {
  const existing = (
    await db.query<{ organization_id: string }>(
      `SELECT organization_id FROM ${table} WHERE id=$1`,
      [rowId],
    )
  ).rows[0];
  if (existing && existing.organization_id !== organizationId)
    throw new Error('Seed ID belongs to another organization');
  return !!existing;
}
export async function seedCatalogue(
  db: QueryRunner,
  organizationId: string,
  userId: string,
  group: 1 | 2,
) {
  for (const [index, [code, name, order]] of categories.entries()) {
    const rowId = id('31000000', group, index + 1);
    if (await owned(db, 'lab_test_categories', rowId, organizationId)) continue;
    await db.query(
      `INSERT INTO lab_test_categories(id,organization_id,code,name,display_order)
 VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,code) DO NOTHING`,
      [rowId, organizationId, code, name, order],
    );
  }
  for (const [index, [code, symbol, name]] of units.entries()) {
    const rowId = id('32000000', group, index + 1);
    if (await owned(db, 'lab_units', rowId, organizationId)) continue;
    await db.query(
      `INSERT INTO lab_units(id,organization_id,code,symbol,name)
 VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,code) DO NOTHING`,
      [rowId, organizationId, code, symbol, name],
    );
  }
  const category = async (code: string) =>
    (
      await db.query<{ id: string }>(
        'SELECT id FROM lab_test_categories WHERE organization_id=$1 AND code=$2',
        [organizationId, code],
      )
    ).rows[0].id;
  const unit = async (code: string) =>
    (
      await db.query<{ id: string }>(
        'SELECT id FROM lab_units WHERE organization_id=$1 AND code=$2',
        [organizationId, code],
      )
    ).rows[0].id;
  const tests =
    group === 1
      ? [
          {
            index: 1,
            code: 'GLU',
            name: 'Glucose',
            short: 'Glu',
            category: 'BIOCHEMISTRY',
            specimen: 'SERUM',
            unit: 'MG_DL',
            method: 'Hexokinase',
            order: 10,
            price: '8.00',
            ranges: [
              {
                index: 1,
                sex: 'ANY',
                ageMin: '18',
                ageMax: '120',
                lower: '70',
                upper: '99',
                criticalLow: '40',
                criticalHigh: '450',
              },
            ],
          },
          {
            index: 2,
            code: 'HGB',
            name: 'Hemoglobin',
            short: 'Hb',
            category: 'HEMATOLOGY',
            specimen: 'WHOLE_BLOOD',
            unit: 'G_DL',
            method: 'Photometric',
            order: 20,
            price: '6.50',
            ranges: [
              {
                index: 2,
                sex: 'MALE',
                ageMin: '18',
                ageMax: '120',
                lower: '13.5',
                upper: '17.5',
                criticalLow: '7',
                criticalHigh: '20',
              },
              {
                index: 3,
                sex: 'FEMALE',
                ageMin: '18',
                ageMax: '120',
                lower: '12.0',
                upper: '16.0',
                criticalLow: '7',
                criticalHigh: '20',
              },
            ],
          },
          {
            index: 3,
            code: 'TSH',
            name: 'Thyroid stimulating hormone',
            short: 'TSH',
            category: 'HORMONES',
            specimen: 'SERUM',
            unit: 'MIU_L',
            method: 'Immunoassay',
            order: 30,
            price: '12.00',
            ranges: [
              {
                index: 4,
                sex: 'ANY',
                ageMin: '18',
                ageMax: '120',
                lower: '0.4',
                upper: '4.0',
              },
            ],
          },
          {
            index: 4,
            code: 'CRP',
            name: 'C-reactive protein',
            short: 'CRP',
            category: 'IMMUNOLOGY',
            specimen: 'SERUM',
            unit: 'MG_L',
            method: 'Immunoturbidimetry',
            order: 40,
            price: '9.00',
            ranges: [
              {
                index: 5,
                sex: 'ANY',
                ageMin: '',
                ageMax: '',
                lower: '0',
                upper: '5',
              },
            ],
          },
          {
            index: 5,
            code: 'ALT',
            name: 'Alanine aminotransferase',
            short: 'ALT',
            category: 'BIOCHEMISTRY',
            specimen: 'SERUM',
            unit: 'U_L',
            method: 'IFCC',
            order: 15,
            price: '7.00',
            ranges: [
              {
                index: 6,
                sex: 'ANY',
                ageMin: '18',
                ageMax: '120',
                lower: '0',
                upper: '41',
              },
            ],
          },
          {
            index: 6,
            code: 'CBC',
            name: 'Complete blood count',
            short: 'CBC',
            category: 'HEMATOLOGY',
            specimen: 'WHOLE_BLOOD',
            unit: 'X10E9_L',
            method: 'Automated hematology',
            order: 25,
            price: '10.00',
            ranges: [
              {
                index: 7,
                sex: 'ANY',
                ageMin: '18',
                ageMax: '120',
                lower: '4.0',
                upper: '11.0',
              },
            ],
          },
        ]
      : [
          {
            index: 1,
            code: 'GLU',
            name: 'Glucose',
            short: 'Glu',
            category: 'BIOCHEMISTRY',
            specimen: 'SERUM',
            unit: 'MG_DL',
            method: 'Hexokinase',
            order: 10,
            price: '7.50',
            ranges: [
              {
                index: 1,
                sex: 'ANY',
                ageMin: '18',
                ageMax: '120',
                lower: '70',
                upper: '100',
              },
            ],
          },
        ];
  for (const test of tests) {
    const testId = id('33000000', group, test.index);
    if (await owned(db, 'lab_tests', testId, organizationId)) continue;
    const exists = (
      await db.query<{ id: string }>(
        'SELECT id FROM lab_tests WHERE organization_id=$1 AND code=$2',
        [organizationId, test.code],
      )
    ).rows[0];
    if (exists) continue;
    await db.query(
      `INSERT INTO lab_tests(
 id,organization_id,category_id,code,name,short_name,description,specimen_type,result_type,unit_id,method,
 display_order,base_price,created_by,updated_by)
 VALUES($1,$2,$3,$4,$5,$6,'',$7,'NUMERIC',$8,$9,$10,$11,$12,$12)`,
      [
        testId,
        organizationId,
        await category(test.category),
        test.code,
        test.name,
        test.short,
        test.specimen,
        await unit(test.unit),
        test.method,
        test.order,
        test.price,
        userId,
      ],
    );
    await db.query(
      `INSERT INTO audit_events(organization_id,user_id,action,entity_type,entity_id,metadata)
 VALUES($1,$2,'LAB_TEST_CREATED','LAB_TEST',$3,'{"fields":["code","name"]}')`,
      [organizationId, userId, testId],
    );
    for (const range of test.ranges) {
      const rangeId = id('34000000', group, range.index);
      if (await owned(db, 'lab_reference_ranges', rangeId, organizationId))
        continue;
      await db.query(
        `INSERT INTO lab_reference_ranges(
 id,organization_id,test_id,sex,age_min,age_max,age_unit,lower_bound,upper_bound,unit_id,method,
 critical_low,critical_high,created_by)
 VALUES($1,$2,$3,$4,$5,$6,'YEARS',$7,$8,$9,$10,$11,$12,$13)`,
        [
          rangeId,
          organizationId,
          testId,
          range.sex,
          range.ageMin || null,
          range.ageMax || null,
          range.lower,
          range.upper,
          await unit(test.unit),
          test.method,
          'criticalLow' in range ? range.criticalLow : null,
          'criticalHigh' in range ? range.criticalHigh : null,
          userId,
        ],
      );
      await db.query(
        `INSERT INTO audit_events(organization_id,user_id,action,entity_type,entity_id,metadata)
 VALUES($1,$2,'REFERENCE_RANGE_CREATED','LAB_REFERENCE_RANGE',$3,'{"fields":["sex","lower_bound","upper_bound"]}')`,
        [organizationId, userId, rangeId],
      );
    }
  }
}
