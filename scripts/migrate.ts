import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let client: PoolClient | undefined;
try {
  client = await pool.connect();
  await client.query('SELECT pg_advisory_lock(20260910)');
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of (
    await readdir(new URL('../db/migrations/', import.meta.url))
  )
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    const sql = await readFile(
      new URL(`../db/migrations/${name}`, import.meta.url),
      'utf8',
    );
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = await client.query(
      'SELECT checksum FROM schema_migrations WHERE name=$1',
      [name],
    );
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum)
        throw new Error('Applied migration checksum mismatch');
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',
        [name, checksum],
      );
      await client.query('COMMIT');
      console.info(`Applied ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} catch {
  console.error(
    'Migration failed. Check database connectivity and migration compatibility. No credentials are logged.',
  );
  process.exitCode = 1;
} finally {
  if (client) {
    await client.query('SELECT pg_advisory_unlock(20260910)');
    client.release();
  }
  await pool.end();
}
