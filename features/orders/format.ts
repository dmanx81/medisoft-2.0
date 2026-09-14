export { specimenLabels } from '@/features/catalogue/format';
export const orderStatusLabels: Record<string, string> = {
  DRAFT: 'Draft',
  ORDERED: 'Ordered',
  PARTIALLY_COLLECTED: 'Partially collected',
  COLLECTED: 'Collected',
  RECEIVED: 'Received',
  IN_PROCESS: 'In process',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
export const priorityLabels: Record<string, string> = {
  ROUTINE: 'Routine',
  URGENT: 'Urgent',
};
export const fastingLabels: Record<string, string> = {
  UNKNOWN: 'Not specified',
  FASTING: 'Fasting',
  NON_FASTING: 'Non-fasting',
};
export const specimenStatusLabels: Record<string, string> = {
  COLLECTED: 'Collected',
  RECEIVED: 'Received',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};
export const orderActivityLabels: Record<string, string> = {
  LAB_ORDER_CREATED: 'Order created',
  LAB_ORDER_UPDATED: 'Order updated',
  LAB_ORDER_PLACED: 'Order placed',
  LAB_ORDER_CANCELLED: 'Order cancelled',
  LAB_ORDER_TEST_ADDED: 'Test added',
  LAB_ORDER_TEST_CANCELLED: 'Ordered test cancelled',
  LAB_ORDER_TEST_REMOVED: 'Draft test removed',
  SPECIMEN_CREATED: 'Specimen registered',
  SPECIMEN_COLLECTED: 'Specimen collected',
  SPECIMEN_RECEIVED: 'Specimen received',
  SPECIMEN_REJECTED: 'Specimen rejected',
  SPECIMEN_TEST_LINKED: 'Specimen linked to tests',
  LAB_ORDER_IN_PROCESS: 'Result processing started',
  LAB_ORDER_COMPLETED: 'Order completed',
  LAB_ORDER_REOPENED: 'Order reopened',
  LAB_INVOICE_CREATED: 'Invoice draft created',
  LAB_INVOICE_UPDATED: 'Invoice draft updated',
  LAB_INVOICE_ISSUED: 'Invoice issued',
  LAB_INVOICE_CANCELLED: 'Invoice cancelled',
  LAB_PAYMENT_RECORDED: 'Payment recorded',
  LAB_INVOICE_DOWNLOADED: 'Invoice PDF downloaded',
  LAB_PAYMENT_REVERSED: 'Payment reversed',
  LAB_CREDIT_NOTE_CREATED: 'Credit note draft created',
  LAB_CREDIT_NOTE_ISSUED: 'Credit note issued',
  LAB_RECEIPT_DOWNLOADED: 'Receipt PDF downloaded',
  LAB_INVOICE_EMAILED: 'Invoice emailed',
};
export function stampLabel(value: string) {
  if (!value) return '—';
  return value.slice(0, 16).replace('T', ' ');
}
export function coverageLabel(covered: number, total: number) {
  if (total === 0) return 'No tests';
  return `${covered}/${total} tests covered`;
}
