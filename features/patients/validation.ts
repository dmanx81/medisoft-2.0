import { z } from 'zod';
const optionalText = (max: number) => z.string().trim().max(max).default('');
const phone = optionalText(40).refine(
  (v) => !v || (/^[+\d\s().-]+$/.test(v) && v.replace(/\D/g, '').length >= 5),
  'Enter a valid phone number',
);
export const patientSchema = z
  .object({
    first_name: z.string().trim().min(1, 'First name is required').max(100),
    last_name: z.string().trim().min(1, 'Last name is required').max(100),
    date_of_birth: optionalText(10).refine((value) => {
      if (!value) return true;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00Z`);
      return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value &&
        value >= '1850-01-01' &&
        value <= new Date().toISOString().slice(0, 10)
      );
    }, 'Enter a valid birth date that is not in the future'),
    sex: z.enum(['UNKNOWN', 'FEMALE', 'MALE', 'INTERSEX']).default('UNKNOWN'),
    national_id: optionalText(64).refine(
      (v) => !v || (/^[a-zA-Z0-9 -]+$/.test(v) && /[a-zA-Z0-9]/.test(v)),
      'Use letters, numbers, spaces or hyphens',
    ),
    phone,
    secondary_phone: phone,
    email: optionalText(254)
      .transform((v) => v.toLowerCase())
      .refine(
        (v) => !v || z.email().safeParse(v).success,
        'Enter a valid email address',
      ),
    address_line_1: optionalText(200),
    address_line_2: optionalText(200),
    city: optionalText(100),
    postal_code: optionalText(20),
    country: optionalText(2)
      .transform((v) => v.toUpperCase())
      .refine(
        (v) => !v || /^[A-Z]{2}$/.test(v),
        'Use a two-letter country code, such as AL',
      ),
    emergency_contact_name: optionalText(160),
    emergency_contact_phone: phone,
    notes: optionalText(4000),
    preferred_language: z.enum(['en', 'sq']).default('sq'),
    status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  })
  .strict();
export type PatientInput = z.output<typeof patientSchema>;
export const emptyPatient: PatientInput = {
  ...patientSchema.parse({ first_name: 'New', last_name: 'Patient' }),
  first_name: '',
  last_name: '',
};
export const searchSchema = z
  .object({
    query: z.string().trim().max(150).default(''),
    page: z.number().int().min(1).max(100000).default(1),
    pageSize: z.number().int().min(1).max(50).default(20),
    sort: z
      .enum(['name', 'patient_number', 'date_of_birth', 'updated_at'])
      .default('name'),
    direction: z.enum(['asc', 'desc']).default('asc'),
    status: z.enum(['ALL', 'ACTIVE', 'INACTIVE']).default('ALL'),
  })
  .strict();
export type PatientSearch = z.output<typeof searchSchema>;
export const createSchema = z
  .object({
    data: patientSchema,
    acknowledgeDuplicates: z.boolean().default(false),
  })
  .strict();
export const updateSchema = createSchema
  .extend({ version: z.number().int().positive() })
  .strict();
export const patientIdSchema = z.uuid();
export function fieldErrors(error: z.ZodError): Record<string, string> {
  return Object.fromEntries(
    error.issues.map((issue) => [
      String(
        issue.path[0] === 'data'
          ? (issue.path[1] ?? 'form')
          : (issue.path[0] ?? 'form'),
      ),
      issue.message,
    ]),
  );
}
