import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max).default('');
const requiredName = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max);

export const doctorSchema = z.object({
  user_id: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(z.uuid().optional()),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((value) => !value || z.email().safeParse(value).success, 'Enter a valid email')
    .default(''),
  first_name: requiredName(100, 'First name is required'),
  last_name: requiredName(100, 'Last name is required'),
  display_name: text(160),
  title: text(80),
  specialty: text(120),
  license_number: text(80),
  phone: text(40),
  professional_email: text(254).refine(
    (value) => !value || z.email().safeParse(value).success,
    'Enter a valid professional email',
  ),
  qualifications: text(500),
  department: text(120),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

export const doctorUpdateSchema = doctorSchema
  .omit({ user_id: true, email: true })
  .extend({ version: z.number().int().positive() });

export const doctorSearchSchema = z.object({
  query: z.string().trim().max(150).default(''),
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
  status: z.enum(['ALL', 'ACTIVE', 'INACTIVE']).default('ALL'),
});

export const prescriptionItemSchema = z.object({
  medication_name: requiredName(160, 'Medication name is required'),
  strength: text(80),
  form: text(80),
  dose: text(80),
  route: text(80),
  frequency: text(80),
  duration: text(80),
  quantity: text(80),
  instructions: text(500),
  sort_order: z.number().int().min(1).max(200).optional(),
});

export const prescriptionDraftSchema = z.object({
  patient_id: z.uuid(),
  doctor_id: z.uuid(),
  prescribed_on: z
    .string()
    .trim()
    .refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Enter a valid date')
    .default(''),
  clinical_note: text(2000),
  instructions: text(2000),
  items: z.array(prescriptionItemSchema).max(40).default([]),
  source_template_id: z.uuid().optional(),
});

export const prescriptionUpdateSchema = z.object({
  doctor_id: z.uuid().optional(),
  prescribed_on: z
    .string()
    .trim()
    .refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Enter a valid date')
    .optional(),
  clinical_note: text(2000).optional(),
  instructions: text(2000).optional(),
  items: z.array(prescriptionItemSchema).max(40).optional(),
  source_template_id: z.uuid().optional(),
  version: z.number().int().positive(),
});

export const prescriptionSearchSchema = z.object({
  query: z.string().trim().max(150).default(''),
  patient_id: z.uuid().optional(),
  status: z.enum(['', 'DRAFT', 'FINALIZED', 'CANCELLED']).default(''),
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});

export const cancelSchema = z.object({
  reason: requiredName(500, 'A cancellation reason is required'),
  version: z.number().int().positive(),
});

export const brandingSchema = z.object({
  legal_name: text(160),
  address: text(500),
  city: text(100),
  postal_code: text(20),
  phone: text(40),
  email: text(254).refine(
    (value) => !value || z.email().safeParse(value).success,
    'Enter a valid email',
  ),
  website: text(200),
  registration_number: text(80),
});

export const prescriptionIdSchema = z.uuid();
export const doctorIdSchema = z.uuid();
export const templateIdSchema = z.uuid();

export const templateSchema = z.object({
  name: requiredName(160, 'Template name is required'),
  description: text(2000),
  category: text(120),
  is_active: z.boolean().default(true),
  items: z.array(prescriptionItemSchema).max(40).default([]),
});

export const templateUpdateSchema = templateSchema.extend({
  version: z.number().int().positive(),
});

export const templateSearchSchema = z.object({
  query: z.string().trim().max(150).default(''),
  category: z.string().trim().max(120).default(''),
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
  status: z.enum(['ALL', 'ACTIVE', 'INACTIVE']).default('ALL'),
});

export const applyTemplateSchema = z.object({
  template_id: z.uuid(),
  version: z.number().int().positive(),
});

export function fieldErrors(error: z.ZodError): Record<string, string> {
  return Object.fromEntries(
    error.issues.map((issue) => [
      String(issue.path[0] ?? 'form'),
      issue.message,
    ]),
  );
}

export const emptyDoctor = doctorSchema.parse({
  first_name: 'Doctor',
  last_name: 'Profile',
});

export const emptyItem = prescriptionItemSchema.parse({
  medication_name: 'Medication',
});

export const emptyTemplate = templateSchema.parse({
  name: 'Template',
});
