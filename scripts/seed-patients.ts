import type { QueryRunner } from '../lib/db/query';
// Fixed UUIDs provide idempotency even when staff edit every demographic field.
export async function seedPatients(
  db: QueryRunner,
  organizationId: string,
  userId: string,
  group: 1 | 2,
) {
  for (let index = 1; index <= 3; index++) {
    const id = `10000000-0000-4000-8000-0000000000${group}${index}`;
    const existing = (
      await db.query<{ organization_id: string }>(
        'SELECT organization_id FROM patients WHERE id=$1',
        [id],
      )
    ).rows[0];
    if (existing) {
      if (existing.organization_id !== organizationId)
        throw new Error('Seed ID belongs to another organization');
      continue;
    }
    const number = (
      await db.query<{ last_number: string }>(
        `INSERT INTO patient_counters(organization_id,last_number) VALUES($1,1)
  ON CONFLICT(organization_id) DO UPDATE SET last_number=patient_counters.last_number+1 RETURNING last_number::text`,
        [organizationId],
      )
    ).rows[0].last_number;
    await db.query(
      `INSERT INTO patients(id,organization_id,patient_number,first_name,last_name,date_of_birth,email,notes,created_by,updated_by)
  VALUES($1,$2,$3,$4,'Development example','1990-01-01',$5,'SYNTHETIC DEVELOPMENT RECORD — not a real patient',$6,$6)`,
      [
        id,
        organizationId,
        `PAT-${number.padStart(6, '0')}`,
        `Example ${group}-${index}`,
        `example-${group}-${index}@example.test`,
        userId,
      ],
    );
    await db.query(
      'INSERT INTO audit_events(organization_id,user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,\'PATIENT_CREATED\',\'PATIENT\',$3,\'{"fields":["first_name","last_name"]}\')',
      [organizationId, userId, id],
    );
  }
}
