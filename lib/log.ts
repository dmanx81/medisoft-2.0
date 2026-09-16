export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const secretKey =
  /pass(word|phrase)?|secret|token|cookie|authorization|database_url|migration_database_url|smtp(_url|_password)?|set-cookie|session/i;

function currentLevel(): LogLevel {
  const value = process.env.LOG_LEVEL;
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error')
    return value;
  return 'info';
}

const rank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/postgres(?:ql)?:\/\//i.test(value)) return '[redacted]';
    if (/smtps?:\/\//i.test(value)) return '[redacted]';
    return value;
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, nested]) => [
        key,
        secretKey.test(key) ? '[redacted]' : redactValue(nested),
      ],
    );
    return Object.fromEntries(entries);
  }
  return value;
}

export function redact(value: unknown) {
  return redactValue(value);
}

export function log(
  level: LogLevel,
  message: string,
  context: Record<string, unknown> = {},
) {
  if (rank[level] < rank[currentLevel()]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(redact(context) as Record<string, unknown>),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

export function logInfo(message: string, context?: Record<string, unknown>) {
  log('info', message, context);
}

export function logWarn(message: string, context?: Record<string, unknown>) {
  log('warn', message, context);
}

export function logError(message: string, context?: Record<string, unknown>) {
  log('error', message, context);
}

export function logUnexpectedFailure(area: string) {
  logError('Unhandled application failure', { area });
}
