import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { postgresClientEnv } from '../lib/db/postgres-cli';
import {
  administrativeDatabaseUrl,
  missingAdministrativeUrlMessage,
} from '../lib/db/administrative-url';

if (process.env.CONFIRM_RESTORE !== 'YES') {
  console.error(
    'Refusing to restore. Restores replace the target database. Set CONFIRM_RESTORE=YES.',
  );
  process.exit(1);
}
let connection: ReturnType<typeof administrativeDatabaseUrl>;
try {
  connection = administrativeDatabaseUrl(process.env);
} catch {
  console.error(missingAdministrativeUrlMessage);
  process.exit(1);
}
const backupFile = process.env.BACKUP_FILE;
if (!backupFile) {
  console.error('BACKUP_FILE is required.');
  process.exit(1);
}
try {
  await access(backupFile);
} catch {
  console.error('BACKUP_FILE could not be read.');
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

const child = spawn(
  'pg_restore',
  [
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-acl',
    '--exit-on-error',
    '--dbname',
    env.PGDATABASE,
    backupFile,
  ],
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
  console.error('Restore failed. Check the backup file and target database. No credentials are logged.');
  process.exit(code);
}
console.info('Restore completed. Re-apply runtime role grants before starting the application.');
