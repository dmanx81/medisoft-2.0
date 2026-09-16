import { z } from 'zod';
export const prescriptionStatuses = ['DRAFT', 'FINALIZED', 'CANCELLED'] as const;
export const prescriptionIdSchema = z.uuid();
const text = (max: number) => z.string().trim().max(max).default('');
export const prescriptionItemSchema = z
  .object({
    medication_name: z.string().trim().min(1).max(200),
    strength: text(80),
    form: text(80),
    dose: text(80),
    route: text(80),
    frequency: text(80),
    duration: text(80),
    quantity: text(80),
    instructions: text(500),
  })
  .strict();
export const createPrescriptionSchema = z
  .object({
    patient_id: z.uuid(),
    doctor_id: z.uuid().optional(),
    prescription_date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    clinical_note: text(2000),
    general_instructions: text(2000),
    items: z.array(prescriptionItemSchema).max(40).default([]),
  })
  .strict();
export const updatePrescriptionSchema = z
  .object({
    doctor_id: z.uuid().optional(),
    prescription_date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/),
    clinical_note: text(2000),
    general_instructions: text(2000),
    items: z.array(prescriptionItemSchema).max(40),
    version: z.number().int().positive(),
  })
  .strict();
export const finalizePrescriptionSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export const cancelPrescriptionSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
    version: z.number().int().positive(),
  })
  .strict();
export const searchSchema = z
  .object({
    query: z.string().trim().max(120).default(''),
    status: z.enum(['ALL', ...prescriptionStatuses]).default('ALL'),
    patient_id: z.uuid().optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export const emptyItem = {
  medication_name: '',
  strength: '',
  form: '',
  dose: '',
  route: '',
  frequency: '',
  duration: '',
  quantity: '',
  instructions: '',
};
export function fieldErrors(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}
