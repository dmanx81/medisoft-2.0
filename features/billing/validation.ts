import { z } from 'zod';
export const invoiceStatuses = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
] as const;
export const discountTypes = ['NONE', 'PERCENT', 'FIXED'] as const;
export const paymentMethods = ['CASH', 'CARD', 'BANK_TRANSFER', 'OTHER'] as const;
export const invoiceIdSchema = z.uuid();
const money = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, 'Enter an amount with up to two decimals.');
export const createInvoiceSchema = z.object({}).strict();
const dueDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a due date as YYYY-MM-DD.');
export const updateInvoiceSchema = z
  .object({
    discount_type: z.enum(discountTypes),
    discount_value: money.default('0'),
    tax_rate: money.default('0'),
    notes: z.string().trim().max(2000).default(''),
    due_date: z.union([z.literal(''), dueDate]).default(''),
    version: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.discount_type === 'NONE' && value.discount_value !== '0') {
      context.addIssue({
        code: 'custom',
        path: ['discount_value'],
        message: 'A none discount cannot include a value.',
      });
    }
    if (value.discount_type === 'PERCENT') {
      const amount = Number(value.discount_value);
      if (amount > 100) {
        context.addIssue({
          code: 'custom',
          path: ['discount_value'],
          message: 'Percentage discounts cannot exceed 100.',
        });
      }
    }
    const tax = Number(value.tax_rate);
    if (tax > 100) {
      context.addIssue({
        code: 'custom',
        path: ['tax_rate'],
        message: 'Tax rate cannot exceed 100.',
      });
    }
  });
export const issueInvoiceSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export const cancelInvoiceSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
    version: z.number().int().positive(),
  })
  .strict();
export const recordPaymentSchema = z
  .object({
    amount: money,
    method: z.enum(paymentMethods),
    reference: z.string().trim().max(120).default(''),
    notes: z.string().trim().max(500).default(''),
    version: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.amount === '0' || value.amount === '0.0' || value.amount === '0.00') {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Payment amount must be greater than zero.',
      });
    }
  });
export const reversePaymentSchema = z
  .object({
    amount: money,
    reason: z.string().trim().min(1).max(500),
    version: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.amount === '0' || value.amount === '0.0' || value.amount === '0.00') {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Reversal amount must be greater than zero.',
      });
    }
  });
export const createCreditNoteSchema = z
  .object({
    amount: money,
    reason: z.string().trim().min(1).max(500),
    notes: z.string().trim().max(2000).default(''),
    version: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.amount === '0' || value.amount === '0.0' || value.amount === '0.00') {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Credit amount must be greater than zero.',
      });
    }
  });
export const issueCreditNoteSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export const emailInvoiceSchema = z
  .object({
    recipient: z.email('Enter a valid email address.').max(254),
    version: z.number().int().positive(),
  })
  .strict();
export const updateBillingSettingsSchema = z
  .object({
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, 'Currency must be a three-letter ISO code.'),
    default_tax_rate: money,
  })
  .strict()
  .superRefine((value, context) => {
    const tax = Number(value.default_tax_rate);
    if (tax > 100) {
      context.addIssue({
        code: 'custom',
        path: ['default_tax_rate'],
        message: 'Tax rate cannot exceed 100.',
      });
    }
  });
export const paymentIdSchema = z.uuid();
export const creditNoteIdSchema = z.uuid();
export const searchSchema = z
  .object({
    query: z.string().trim().max(80).default(''),
    status: z.enum(['', ...invoiceStatuses]).default(''),
    patient_id: z.union([z.literal(''), z.uuid()]).default(''),
    page: z.number().int().min(1).max(100000).default(1),
    pageSize: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export type InvoiceSearch = z.output<typeof searchSchema>;
export function fieldErrors(error: z.ZodError): Record<string, string> {
  return Object.fromEntries(
    error.issues.map((issue) => [
      String(issue.path[0] ?? 'form'),
      issue.message,
    ]),
  );
}
