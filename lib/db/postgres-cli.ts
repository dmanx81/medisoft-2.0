export function postgresClientEnv(databaseUrl: string) {
  const url = new URL(databaseUrl.replace(/^postgres(?:ql)?:/i, 'http:'));
  const database = url.pathname.replace(/^\//, '').split('/')[0];
  if (!url.hostname || !database) throw new Error('Invalid PostgreSQL URL');
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
  };
}
