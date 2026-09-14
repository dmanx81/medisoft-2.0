import { formatMoney, parseMoney, ZERO_CENTS } from './money';
import type { InvoiceStatus } from './types';

export type InvoiceLedger = {
  billed_total: string;
  gross_paid: string;
  reversed: string;
  net_paid: string;
  credited: string;
  balance_due: string;
  payment_status: Exclude<InvoiceStatus, 'DRAFT' | 'CANCELLED'>;
};

export function deriveInvoiceLedger(input: {
  billed_total: string;
  gross_paid: string;
  reversed: string;
  credited: string;
}): InvoiceLedger {
  const billed = parseMoney(input.billed_total);
  const gross = parseMoney(input.gross_paid);
  const reversed = parseMoney(input.reversed);
  const credited = parseMoney(input.credited);
  if (gross < ZERO_CENTS || reversed < ZERO_CENTS || credited < ZERO_CENTS)
    throw new Error('Financial ledger amounts cannot be negative.');
  if (reversed > gross)
    throw new Error('Reversed amount cannot exceed recorded payments.');
  const netPaid = gross - reversed;
  const remaining = billed - netPaid - credited;
  if (remaining < ZERO_CENTS)
    throw new Error('Credits and net payments cannot exceed billed total.');
  let payment_status: InvoiceLedger['payment_status'] = 'PARTIALLY_PAID';
  if (remaining === ZERO_CENTS) payment_status = 'PAID';
  else if (netPaid === ZERO_CENTS && credited === ZERO_CENTS)
    payment_status = 'ISSUED';
  return {
    billed_total: formatMoney(billed),
    gross_paid: formatMoney(gross),
    reversed: formatMoney(reversed),
    net_paid: formatMoney(netPaid),
    credited: formatMoney(credited),
    balance_due: formatMoney(remaining),
    payment_status,
  };
}

export function invoiceIsOverdue(input: {
  status: InvoiceStatus;
  due_date: string;
  balance_due: string;
  today?: string;
}) {
  if (input.status === 'DRAFT' || input.status === 'CANCELLED') return false;
  if (!input.due_date) return false;
  if (parseMoney(input.balance_due) <= ZERO_CENTS) return false;
  const today = input.today || new Date().toISOString().slice(0, 10);
  return input.due_date < today;
}
