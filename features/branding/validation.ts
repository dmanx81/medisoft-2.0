import { z } from 'zod';
export const brandingSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    legal_name: z.string().trim().max(160).default(''),
    address: z.string().trim().max(500).default(''),
    city: z.string().trim().max(80).default(''),
    postal_code: z.string().trim().max(20).default(''),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'Use a two-letter country code.'),
    phone: z.string().trim().max(40).default(''),
    email: z
      .string()
      .trim()
      .max(254)
      .default('')
      .refine(
        (value) => value === '' || z.email().safeParse(value).success,
        'Enter a valid email address.',
      ),
    website: z
      .string()
      .trim()
      .max(200)
      .default('')
      .refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return url.protocol === 'https:' || url.protocol === 'http:';
        } catch {
          return false;
        }
      }, 'Enter a valid http(s) website.'),
    registration_number: z.string().trim().max(80).default(''),
  })
  .strict();
export function fieldErrors(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}
