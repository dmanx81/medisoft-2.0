import { z } from 'zod';
export const doctorStatuses = ['ACTIVE', 'INACTIVE'] as const;
export const doctorIdSchema = z.uuid();
export const doctorSchema = z
  .object({
    user_id: z.uuid(),
    first_name: z.string().trim().min(1).max(100),
    last_name: z.string().trim().min(1).max(100),
    display_name: z.string().trim().max(160).default(''),
    title: z.string().trim().max(80).default(''),
    specialty: z.string().trim().max(120).default(''),
    license_number: z.string().trim().max(80).default(''),
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
    qualifications: z.string().trim().max(500).default(''),
    department: z.string().trim().max(120).default(''),
    status: z.enum(doctorStatuses).default('ACTIVE'),
  })
  .strict();
export const createDoctorSchema = doctorSchema;
export const updateDoctorSchema = doctorSchema
  .omit({ user_id: true })
  .extend({ version: z.number().int().positive() })
  .strict();
export const searchSchema = z
  .object({
    query: z.string().trim().max(120).default(''),
    status: z.enum(['ALL', ...doctorStatuses]).default('ALL'),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export const emptyDoctor = {
  user_id: '',
  first_name: '',
  last_name: '',
  display_name: '',
  title: '',
  specialty: '',
  license_number: '',
  phone: '',
  email: '',
  qualifications: '',
  department: '',
  status: 'ACTIVE' as const,
};
export function displayNameOf(input: {
  display_name?: string;
  first_name: string;
  last_name: string;
  title?: string;
}) {
  const explicit = input.display_name?.trim();
  if (explicit) return explicit;
  const name = `${input.first_name} ${input.last_name}`.trim();
  return input.title ? `${input.title} ${name}`.trim() : name;
}
export function fieldErrors(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}
