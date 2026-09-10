import { z } from 'zod';
const schema = z
  .object({
    DATABASE_URL: z.url().refine((v) => /^postgres(?:ql)?:/.test(v)),
    APP_ORIGIN: z
      .url()
      .refine(
        (v) => new URL(v).origin === v,
        'Use an origin without a trailing slash or path',
      ),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    DASHBOARD_DEMO: z.enum(['true', 'false']).default('false'),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === 'production' && !v.APP_ORIGIN.startsWith('https://'))
      ctx.addIssue({ code: 'custom', message: 'Production requires HTTPS' });
    if (v.NODE_ENV === 'production' && v.DASHBOARD_DEMO === 'true')
      ctx.addIssue({
        code: 'custom',
        message: 'Demo data is forbidden in production',
      });
  });
export function parseEnvironment(values: Record<string, string | undefined>) {
  const result = schema.safeParse(values);
  if (!result.success)
    throw new Error(
      'Invalid server configuration. Check DATABASE_URL, APP_ORIGIN and DASHBOARD_DEMO.',
    );
  return result.data;
}
export function environment() {
  return parseEnvironment(process.env);
}
