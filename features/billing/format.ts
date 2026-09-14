export const invoiceStatusLabels: Record<string, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};
export const paymentMethodLabels: Record<string, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank transfer',
  OTHER: 'Other',
};
export const discountTypeLabels: Record<string, string> = {
  NONE: 'No discount',
  PERCENT: 'Percentage',
  FIXED: 'Fixed amount',
};
export const creditNoteStatusLabels: Record<string, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
};
export const invoiceActivityLabels: Record<string, string> = {
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
  BILLING_SETTINGS_UPDATED: 'Billing settings updated',
  LAB_INVOICE_EMAILED: 'Invoice emailed',
};
export function moneyLabel(amount: string, currency: string) {
  if (!amount) return '—';
  return `${currency} ${amount}`;
}
