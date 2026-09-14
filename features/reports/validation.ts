import { z } from 'zod';
export const reportStatuses = ['ISSUED', 'SUPERSEDED'] as const;
export const deliveryMethods = ['DOWNLOAD', 'PRINT', 'MANUAL'] as const;
export const deliveryStatuses = ['RECORDED', 'FAILED'] as const;
export const reportIdSchema = z.uuid();
export const generateReportSchema = z.object({}).strict();
export const deliverReportSchema = z
  .object({
    method: z.enum(deliveryMethods),
    recipient_descriptor: z.string().trim().max(160).default(''),
    notes: z.string().trim().max(500).default(''),
    status: z.enum(deliveryStatuses).default('RECORDED'),
    failure_reason: z.string().trim().max(500).default(''),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'FAILED' && !value.failure_reason) {
      context.addIssue({
        code: 'custom',
        path: ['failure_reason'],
        message: 'Failure reason is required when delivery failed.',
      });
    }
    if (value.status === 'RECORDED' && value.failure_reason) {
      context.addIssue({
        code: 'custom',
        path: ['failure_reason'],
        message: 'Successful delivery cannot include a failure reason.',
      });
    }
  });
export const searchSchema = z
  .object({
    query: z.string().trim().max(80).default(''),
    page: z.number().int().min(1).max(100000).default(1),
    pageSize: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export const shareExpiries = ['24h', '3d', '7d', '30d'] as const;
export const createShareSchema = z
  .object({
    recipient_name: z.string().trim().max(160).default(''),
    recipient_email: z.string().trim().max(254).default(''),
    purpose: z.string().trim().max(200).default(''),
    expires_in: z.enum(shareExpiries).default('24h'),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.recipient_email &&
      !z.email().safeParse(value.recipient_email.toLowerCase()).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recipient_email'],
        message: 'Enter a valid email address or leave this blank.',
      });
    }
  });
export const verifyShareSchema = z
  .object({
    pin: z
      .string()
      .trim()
      .regex(/^\d{8}$/, 'Enter the 8-digit access PIN.'),
  })
  .strict();
export const shareTokenSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/);
export type ReportSearch = z.output<typeof searchSchema>;
export function fieldErrors(error: z.ZodError): Record<string, string> {
  return Object.fromEntries(
    error.issues.map((issue) => [
      String(issue.path[0] ?? 'form'),
      issue.message,
    ]),
  );
}
