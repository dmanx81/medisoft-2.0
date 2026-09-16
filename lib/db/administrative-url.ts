export class AdministrativeDatabaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdministrativeDatabaseUrlError';
  }
}

export type AdministrativeDatabaseUrlSource =
  | 'MIGRATION_DATABASE_URL'
  | 'DATABASE_URL';

export type AdministrativeDatabaseUrl = {
  url: string;
  source: AdministrativeDatabaseUrlSource;
};

function trimmed(value: string | undefined) {
  return value?.trim() ?? '';
}

function assertPostgresUrl(value: string) {
  if (!/^postgres(?:ql)?:/i.test(value)) {
    throw new AdministrativeDatabaseUrlError(
      'The administrative database URL is not a PostgreSQL connection string.',
    );
  }
  try {
    const parsed = new URL(value.replace(/^postgres(?:ql)?:/i, 'http:'));
    const database = parsed.pathname.replace(/^\//, '').split('/')[0];
    if (!parsed.hostname || !database) {
      throw new AdministrativeDatabaseUrlError(
        'The administrative database URL is not a PostgreSQL connection string.',
      );
    }
  } catch (error) {
    if (error instanceof AdministrativeDatabaseUrlError) throw error;
    throw new AdministrativeDatabaseUrlError(
      'The administrative database URL is not a PostgreSQL connection string.',
    );
  }
}

export function administrativeDatabaseUrl(
  env: Record<string, string | undefined>,
): AdministrativeDatabaseUrl {
  const migration = trimmed(env.MIGRATION_DATABASE_URL);
  const runtime = trimmed(env.DATABASE_URL);
  if (migration) {
    assertPostgresUrl(migration);
    if (env.NODE_ENV === 'production' && runtime && migration === runtime) {
      throw new AdministrativeDatabaseUrlError(
        'MIGRATION_DATABASE_URL must be the schema-owner connection, not DATABASE_URL.',
      );
    }
    return { url: migration, source: 'MIGRATION_DATABASE_URL' };
  }
  if (env.NODE_ENV === 'production') {
    throw new AdministrativeDatabaseUrlError(
      'MIGRATION_DATABASE_URL is required in production. DATABASE_URL is the runtime role and cannot apply schema or backup administration.',
    );
  }
  if (!runtime) {
    throw new AdministrativeDatabaseUrlError('DATABASE_URL is required.');
  }
  assertPostgresUrl(runtime);
  return { url: runtime, source: 'DATABASE_URL' };
}

export const missingAdministrativeUrlMessage =
  'Administrative database URL is missing or invalid. In production set MIGRATION_DATABASE_URL to the schema-owner connection. DATABASE_URL remains the runtime role. No credentials are logged.';
