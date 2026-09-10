import { z } from 'zod';
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(1).max(256),
});
export const organizationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  type: z.enum(['LABORATORY', 'CLINIC', 'DIAGNOSTIC_CENTER']),
  logo: z.url().nullable().default(null),
  address: z.string().max(500).nullable().default(null),
  phone: z.string().max(40).nullable().default(null),
  email: z.email().nullable().default(null),
  country: z.string().regex(/^[A-Z]{2}$/),
  timezone: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }),
  defaultLanguage: z.enum(['en', 'sq']),
});
export function validOrigin(origin: string | null, expected: string): boolean {
  return origin === expected;
}
export function validSessionToken(value: string | undefined): value is string {
  return !!value && /^[a-f0-9]{64}$/.test(value);
}
