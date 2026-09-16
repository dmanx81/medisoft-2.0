import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { postgresClientEnv } from '../lib/db/postgres-cli';
import {
  administrativeDatabaseUrl,
  missingAdministrativeUrlMessage,
} from '../lib/db/administrative-url';

let connection: ReturnType<typeof administrativeDatabaseUrl>;
try {
  connection = administrativeDatabaseUrl(process.env);
} catch {
  console.error(missingAdministrativeUrlMessage);
  process.exit(1);
}
const backupDir = process.env.BACKUP_DIR;
if (!backupDir) {
  console.error('BACKUP_DIR is required.');
  process.exit(1);
}

let env: ReturnType<typeof postgresClientEnv>;
try {
  env = postgresClientEnv(connection.url);
} catch {
  console.error(
    'The administrative database URL is not a valid PostgreSQL URL. No credentials are logged.',
  );
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = join(backupDir, `medisoft-${stamp}.dump`);
await mkdir(backupDir, { recursive: true });
const child = spawn(
  'pg_dump',
  ['--format=custom', '--no-owner', '--no-acl', '--file', destination],
  {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'pipe'],
  },
);
child.stderr.on('data', (chunk: Buffer) => {
  process.stderr.write(String(chunk).replace(env.PGPASSWORD, '[redacted]'));
});
const code: number = await new Promise((resolve) => {
  child.on('close', (value) => resolve(value ?? 1));
});
if (code !== 0) {
  console.error('Backup failed. Check database connectivity. No credentials are logged.');
  process.exit(code);
}
const info = await stat(destination);
if (info.size < 1) {
  console.error('Backup file was empty.');
  process.exit(1);
}
console.info(`Wrote ${destination} (${String(info.size)} bytes)`);
