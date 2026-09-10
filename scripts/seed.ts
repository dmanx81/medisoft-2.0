import { Pool } from 'pg';
import { seedPatients } from './seed-patients';
import { hashPassword } from '../lib/auth/password';
import { organizationSchema, loginSchema } from '../lib/validation';
if (process.env.NODE_ENV === 'production')
  throw new Error('Development seed is disabled in production');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const credentials = loginSchema.safeParse({
  email: process.env.SEED_ADMIN_EMAIL,
  password: process.env.SEED_ADMIN_PASSWORD,
});
if (!credentials.success || credentials.data.password.length < 14)
  throw new Error(
    'Provide SEED_ADMIN_EMAIL and a password of at least 14 characters',
  );
const org = organizationSchema.parse({
  name: 'Development Laboratory',
  slug: 'development-lab',
  type: 'LABORATORY',
  country: 'AL',
  timezone: 'Europe/Tirane',
  defaultLanguage: 'sq',
});
if (process.argv.includes('--dry-run')) {
  console.info(
    'Dry run: upsert two development organizations, a primary administrator and a disabled secondary fixture user; insert six synthetic patients by stable UUID. Existing records/passwords remain unchanged.',
  );
  process.exit(0);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(
    'INSERT INTO organizations(name,slug,type,country,timezone,default_language) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(slug) DO NOTHING',
    [
      org.name,
      org.slug,
      org.type,
      org.country,
      org.timezone,
      org.defaultLanguage,
    ],
  );
  const organization = (
    await client.query('SELECT id FROM organizations WHERE slug=$1', [org.slug])
  ).rows[0];
  const existing = await client.query(
    'SELECT organization_id FROM users WHERE email=$1',
    [credentials.data.email],
  );
  if (existing.rowCount && existing.rows[0].organization_id !== organization.id)
    throw new Error('Seed identity already belongs to another organization');
  const inserted = await client.query(
    "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Development Administrator',$2,$3,'ORG_ADMIN') ON CONFLICT(email) DO NOTHING RETURNING id",
    [
      organization.id,
      credentials.data.email,
      await hashPassword(credentials.data.password),
    ],
  );
  if (inserted.rowCount)
    await client.query(
      "INSERT INTO audit_events(organization_id,user_id,action,entity_type,entity_id) VALUES($1,$2,'USER_SEEDED','USER',($2::uuid)::text)",
      [organization.id, inserted.rows[0].id],
    );
  const primaryUser = (
    await client.query('SELECT id FROM users WHERE email=$1', [
      credentials.data.email,
    ])
  ).rows[0];
  await seedPatients(client, organization.id, primaryUser.id, 1);
  await client.query(
    "INSERT INTO organizations(name,slug,type,country) VALUES('Second Development Clinic','development-clinic-2','CLINIC','AL') ON CONFLICT(slug) DO NOTHING",
  );
  const secondOrg = (
    await client.query(
      "SELECT id FROM organizations WHERE slug='development-clinic-2'",
    )
  ).rows[0];
  await client.query(
    "INSERT INTO users(organization_id,name,email,password_hash,role,status) VALUES($1,'Disabled fixture user','fixture-clinic-2@example.test','disabled-no-password','ORG_ADMIN','DISABLED') ON CONFLICT(email) DO NOTHING",
    [secondOrg.id],
  );
  const secondUser = (
    await client.query(
      "SELECT id,organization_id FROM users WHERE email='fixture-clinic-2@example.test'",
    )
  ).rows[0];
  if (secondUser.organization_id !== secondOrg.id)
    throw new Error(
      'Secondary fixture account belongs to another organization',
    );
  await seedPatients(client, secondOrg.id, secondUser.id, 2);
  await client.query('COMMIT');
  console.info(
    'Development seed complete. Existing records and passwords were preserved.',
  );
} catch {
  await client.query('ROLLBACK');
  console.error(
    'Seed failed; transaction rolled back. Check configuration and existing organization membership.',
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
