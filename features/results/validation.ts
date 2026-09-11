import { z } from 'zod';
const optionalText = (max: number) => z.string().trim().max(max).default('');
export const resultStatuses = [
  'ENTERED',
  'TECHNICALLY_VALIDATED',
  'CLINICALLY_VERIFIED',
  'SUPERSEDED',
] as const;
export const resultFlags = [
  'UNINTERPRETED',
  'NORMAL',
  'LOW',
  'HIGH',
  'CRITICAL_LOW',
  'CRITICAL_HIGH',
] as const;
export const enterResultSchema = z
  .object({
    numeric_value: optionalText(20).refine(
      (value) => !value || /^-?\d+(?:\.\d+)?$/.test(value),
      'Enter a valid number',
    ),
    text_value: optionalText(500),
    boolean_value: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .strict();
export const versionSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export const amendResultSchema = z
  .object({
    numeric_value: optionalText(20).refine(
      (value) => !value || /^-?\d+(?:\.\d+)?$/.test(value),
      'Enter a valid number',
    ),
    text_value: optionalText(500),
    boolean_value: z.boolean().optional(),
    reason: z
      .string()
      .trim()
      .min(1, 'Amendment reason is required')
      .max(500),
    version: z.number().int().positive(),
  })
  .strict();
export const worklistSchema = z
  .object({
    query: z.string().trim().max(80).default(''),
    page: z.number().int().min(1).max(100000).default(1),
    pageSize: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export const resultIdSchema = z.uuid();
export function fieldErrors(error: z.ZodError): Record<string, string> {
  return Object.fromEntries(
    error.issues.map((issue) => [
      String(issue.path[0] ?? 'form'),
      issue.message,
    ]),
  );
}
