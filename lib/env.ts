import { z } from 'zod';

const nodeEnv = z.enum(['development', 'test', 'production']).default('development');
const emailProvider = z.enum(['stub', 'smtp', 'disabled']);
const allowlistedKeys = [
  'DATABASE_URL',
  'APP_ORIGIN',
  'NODE_ENV',
  'DASHBOARD_DEMO',
  'EMAIL_PROVIDER',
  'SMTP_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM',
  'LOG_LEVEL',
] as const;

const placeholderSecrets = new Set([
  'replace-with-local-password',
  'medisoft_local_dev',
  'password',
  'changeme',
  'change-me',
  'secret',
  'postgres',
  'admin',
  'medisoft',
  'test',
  'dummy',
  'placeholder',
  'pass',
  'toor',
  '123456',
  'password123',
  'your-password-here',
]);

const schema = z.object({
  DATABASE_URL: z.string(),
  APP_ORIGIN: z.string(),
  NODE_ENV: nodeEnv,
  DASHBOARD_DEMO: z.enum(['true', 'false']).default('false'),
  EMAIL_PROVIDER: emailProvider.optional(),
  SMTP_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
});

export type AppEnvironment = {
  DATABASE_URL: string;
  APP_ORIGIN: string;
  NODE_ENV: z.infer<typeof nodeEnv>;
  DASHBOARD_DEMO: 'true' | 'false';
  EMAIL_PROVIDER: z.infer<typeof emailProvider>;
  SMTP_URL: string;
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_SECURE: 'true' | 'false' | '';
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  SMTP_FROM: string;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
};

function configurationError(keys: string[]) {
  const unique = [...new Set(keys.filter(Boolean))];
  const suffix = unique.length ? ` (${unique.join(', ')})` : '';
  return new Error(
    `Invalid server configuration${suffix}. Check the production environment documentation.`,
  );
}

function postgresUrl(value: string) {
  if (!/^postgres(?:ql)?:/i.test(value)) return null;
  try {
    return new URL(value.replace(/^postgres(?:ql)?:/i, 'http:'));
  } catch {
    return null;
  }
}

function smtpUrl(value: string) {
  if (!/^smtps?:/i.test(value)) return null;
  try {
    return new URL(value.replace(/^smtps:/i, 'https:').replace(/^smtp:/i, 'http:'));
  } catch {
    return null;
  }
}

function originUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function unsafePublicHostname(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  );
}

export function isPlaceholderSecret(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (placeholderSecrets.has(normalized)) return true;
  return /^(change.?me|replace.?me|your-.+|xxx+|dummy|placeholder|test[-_]?secret)/i.test(
    normalized,
  );
}

function addIssue(keys: string[], key: string) {
  keys.push(key);
}

export function parseEnvironment(values: Record<string, string | undefined>) {
  const parsed = schema.safeParse(values);
  const keys: string[] = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '');
      if ((allowlistedKeys as readonly string[]).includes(key)) addIssue(keys, key);
    }
    throw configurationError(keys);
  }
  const input = parsed.data;
  const database = postgresUrl(input.DATABASE_URL);
  if (!database) addIssue(keys, 'DATABASE_URL');
  const origin = originUrl(input.APP_ORIGIN);
  if (!origin || origin.origin !== input.APP_ORIGIN) addIssue(keys, 'APP_ORIGIN');
  const provider =
    input.EMAIL_PROVIDER ?? (input.NODE_ENV === 'production' ? undefined : 'stub');
  if (!provider) addIssue(keys, 'EMAIL_PROVIDER');
  if (input.NODE_ENV === 'production') {
    if (origin && origin.protocol !== 'https:') addIssue(keys, 'APP_ORIGIN');
    if (origin && unsafePublicHostname(origin.hostname)) addIssue(keys, 'APP_ORIGIN');
    if (input.DASHBOARD_DEMO === 'true') addIssue(keys, 'DASHBOARD_DEMO');
    if (database && isPlaceholderSecret(decodeURIComponent(database.password)))
      addIssue(keys, 'DATABASE_URL');
    if (provider === 'stub') addIssue(keys, 'EMAIL_PROVIDER');
  }
  if (provider === 'smtp') {
    const from = input.SMTP_FROM?.trim() ?? '';
    if (!from || z.email().safeParse(from).success === false) addIssue(keys, 'SMTP_FROM');
    const urlValue = input.SMTP_URL?.trim() ?? '';
    const host = input.SMTP_HOST?.trim() ?? '';
    if (urlValue) {
      const parsedSmtp = smtpUrl(urlValue);
      if (!parsedSmtp) addIssue(keys, 'SMTP_URL');
      else if (input.NODE_ENV === 'production' && unsafePublicHostname(parsedSmtp.hostname))
        addIssue(keys, 'SMTP_URL');
      else if (
        input.NODE_ENV === 'production' &&
        parsedSmtp.password &&
        isPlaceholderSecret(decodeURIComponent(parsedSmtp.password))
      )
        addIssue(keys, 'SMTP_PASSWORD');
    } else if (!host) {
      addIssue(keys, 'SMTP_HOST');
    } else if (input.NODE_ENV === 'production' && unsafePublicHostname(host)) {
      addIssue(keys, 'SMTP_HOST');
    }
    if (input.SMTP_PORT) {
      const port = Number(input.SMTP_PORT);
      if (!Number.isInteger(port) || port < 1 || port > 65535) addIssue(keys, 'SMTP_PORT');
    }
    if (
      input.NODE_ENV === 'production' &&
      input.SMTP_PASSWORD &&
      isPlaceholderSecret(input.SMTP_PASSWORD)
    )
      addIssue(keys, 'SMTP_PASSWORD');
  }
  if (keys.length) throw configurationError(keys);
  return {
    DATABASE_URL: input.DATABASE_URL,
    APP_ORIGIN: input.APP_ORIGIN,
    NODE_ENV: input.NODE_ENV,
    DASHBOARD_DEMO: input.DASHBOARD_DEMO,
    EMAIL_PROVIDER: provider ?? 'stub',
    SMTP_URL: input.SMTP_URL ?? '',
    SMTP_HOST: input.SMTP_HOST ?? '',
    SMTP_PORT: input.SMTP_PORT ?? '',
    SMTP_SECURE: input.SMTP_SECURE ?? '',
    SMTP_USER: input.SMTP_USER ?? '',
    SMTP_PASSWORD: input.SMTP_PASSWORD ?? '',
    SMTP_FROM: input.SMTP_FROM ?? '',
    LOG_LEVEL: input.LOG_LEVEL ?? 'info',
  } satisfies AppEnvironment;
}

export function environment() {
  return parseEnvironment(process.env);
}

export function shouldValidateRuntimeEnvironment() {
  if (process.env.NEXT_RUNTIME === 'edge') return false;
  const phase = process.env.NEXT_PHASE ?? '';
  if (phase.includes('build')) return false;
  const script = process.env.npm_lifecycle_event ?? '';
  return !script.startsWith('build');
}
