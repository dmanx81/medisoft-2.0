'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { InvoiceWorkItem } from '@/features/billing/types';
import { invoiceStatusLabels, moneyLabel } from '@/features/billing/format';
import { formatMoney, parseMoney } from '@/features/billing/money';
import { stampLabel } from '@/features/orders/format';
export function PatientInvoices({ patientId }: { patientId: string }) {
  const [invoices, setInvoices] = useState<InvoiceWorkItem[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/lab-invoices/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patient_id: patientId, pageSize: 20 }),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('unavailable');
        const data = (await response.json()) as { invoices: InvoiceWorkItem[] };
        if (!cancelled) setInvoices(data.invoices);
      } catch {
        if (!cancelled) setError('Invoices could not be loaded.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);
  const outstanding = formatMoney(
    (invoices ?? []).reduce((sum, invoice) => {
      if (invoice.status === 'CANCELLED' || invoice.status === 'DRAFT')
        return sum;
      return sum + parseMoney(invoice.balance_due);
    }, 0n),
  );
  return (
    <div className="rounded-md border border-line bg-white p-5">
      <h2 className="font-semibold">Billing</h2>
      <p className="mt-2 text-sm text-slate">
        Invoice names come from each issued snapshot. Outstanding totals use the
        current payment ledger.
      </p>
      {error && <p className="mt-3 text-sm text-coral">{error}</p>}
      {invoices && invoices.length === 0 && (
        <p className="mt-3 text-sm text-slate">No invoices for this patient.</p>
      )}
      {invoices && invoices.length > 0 && (
        <>
          <p className="mt-3 text-sm">
            Outstanding balance {outstanding} across{' '}
            {invoices.length} invoice{invoices.length === 1 ? '' : 's'}
          </p>
          <ul className="mt-3 divide-y divide-line text-sm">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="flex justify-between py-2">
                <Link className="font-mono text-teal" href={`/app/billing/${invoice.id}`}>
                  {invoice.invoice_number || 'Draft'}
                </Link>
                <span>
                  {invoiceStatusLabels[invoice.status]} ·{' '}
                  {moneyLabel(invoice.total, invoice.currency)} ·{' '}
                  {stampLabel(invoice.issued_at)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
