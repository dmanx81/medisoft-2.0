import { z } from 'zod';
import { specimenTypes } from '@/features/catalogue/validation';
export const orderStatuses = [
  'DRAFT',
  'ORDERED',
  'PARTIALLY_COLLECTED',
  'COLLECTED',
  'RECEIVED',
  'CANCELLED',
] as const;
export const orderPriorities = ['ROUTINE', 'URGENT'] as const;
export const fastingStatuses = ['UNKNOWN', 'FASTING', 'NON_FASTING'] as const;
export const specimenStatuses = [
  'COLLECTED',
  'RECEIVED',
  'REJECTED',
  'CANCELLED',
] as const;
const optionalText = (max: number) => z.string().trim().max(max).default('');
const optionalUuid = optionalText(36).refine(
  (value) => !value || z.uuid().safeParse(value).success,
  'Select a valid record',
);
const optionalDate = optionalText(40).refine((value) => {
  if (!value) return true;
  return !Number.isNaN(Date.parse(value));
}, 'Enter a valid date');
export const orderFields = z
  .object({
    patient_id: z.uuid('Select a patient'),
    priority: z.enum(orderPriorities).default('ROUTINE'),
    ordering_physician_name: optionalText(160),
    clinical_notes: optionalText(4000),
    fasting_status: z.enum(fastingStatuses).default('UNKNOWN'),
    external_reference: optionalText(80),
  })
  .strict();
export type OrderInput = z.output<typeof orderFields>;
export const createOrderSchema = z
  .object({
    data: orderFields.extend({
      test_ids: z.array(z.uuid()).max(100).default([]),
    }),
    place: z.boolean().default(false),
  })
  .strict();
export const updateOrderSchema = z
  .object({
    data: orderFields,
    version: z.number().int().positive(),
  })
  .strict();
export const addTestsSchema = z
  .object({
    test_ids: z.array(z.uuid()).min(1).max(100),
    version: z.number().int().positive(),
  })
  .strict();
export const versionSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export const cancelOrderSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z
      .string()
      .trim()
      .min(1, 'Cancellation reason is required')
      .max(500),
  })
  .strict();
export const createSpecimenSchema = z
  .object({
    specimen_type: z.enum(specimenTypes),
    order_test_ids: z.array(z.uuid()).min(1).max(100),
    collected_at: optionalDate,
    collection_notes: optionalText(2000),
    version: z.number().int().positive(),
  })
  .strict();
export const rejectSpecimenSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(1, 'Rejection reason is required').max(500),
  })
  .strict();
export const searchSchema = z
  .object({
    query: z.string().trim().max(80).default(''),
    page: z.number().int().min(1).max(100000).default(1),
    pageSize: z.number().int().min(1).max(50).default(20),
    sort: z
      .enum(['ordered_at', 'order_number', 'status', 'updated_at'])
      .default('updated_at'),
    direction: z.enum(['asc', 'desc']).default('desc'),
    status: z.enum(['ALL', ...orderStatuses]).default('ALL'),
    priority: z.enum(['ALL', ...orderPriorities]).default('ALL'),
    patient_id: optionalUuid,
    ordered_from: optionalDate,
    ordered_to: optionalDate,
  })
  .strict();
export type OrderSearch = z.output<typeof searchSchema>;
export const emptyOrder: OrderInput = {
  patient_id: '',
  priority: 'ROUTINE',
  ordering_physician_name: '',
  clinical_notes: '',
  fasting_status: 'UNKNOWN',
  external_reference: '',
};
export const orderIdSchema = z.uuid();
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
