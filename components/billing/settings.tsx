'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { OrganizationBillingSettings } from '@/features/billing/types';
type Failure = { code?: string; message?: string; fields?: Record<string, string> };
export function BillingSettingsForm({
  initial,
}: {
  initial: OrganizationBillingSettings;
}) {
  const [settings, setSettings] = useState(initial);
  const [currency, setCurrency] = useState(initial.currency);
  const [taxRate, setTaxRate] = useState(initial.default_tax_rate);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="mt-8 grid gap-3 border-t border-line pt-6"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setFailure(null);
        setSaved(false);
        void (async () => {
          try {
            const response = await fetch('/api/organization/billing', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                currency,
                default_tax_rate: taxRate,
              }),
              cache: 'no-store',
            });
            const payload = (await response.json()) as Failure &
              OrganizationBillingSettings;
            if (!response.ok) {
              setFailure(payload);
              return;
            }
            setSettings(payload);
            setCurrency(payload.currency);
            setTaxRate(payload.default_tax_rate);
            setSaved(true);
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <h3 className="font-medium">Laboratory billing defaults</h3>
      <p className="text-sm text-slate">
        These values apply to newly created draft invoices only. Issued invoice
        snapshots keep their frozen currency and tax.
      </p>
      {failure && (
        <p className="rounded-md border border-coral/30 bg-white p-3 text-sm text-coral" role="alert">
          {failure.message || 'Billing settings could not be saved.'}
        </p>
      )}
      {saved && (
        <p className="text-sm text-teal">Billing defaults saved.</p>
      )}
      <label className="text-sm font-medium" htmlFor="org-billing-currency">
        Currency
        <Input
          id="org-billing-currency"
          className="mt-2"
          value={currency}
          onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          maxLength={3}
          required
        />
      </label>
      <label className="text-sm font-medium" htmlFor="org-billing-tax">
        Default tax rate (%)
        <Input
          id="org-billing-tax"
          className="mt-2"
          value={taxRate}
          onChange={(event) => setTaxRate(event.target.value)}
          required
        />
      </label>
      <p className="text-xs text-slate">
        Current stored defaults: {settings.currency}, {settings.default_tax_rate}%
      </p>
      <button
        type="submit"
        disabled={busy}
        className="w-fit rounded-md bg-teal px-4 py-2 text-sm text-white"
      >
        Save billing defaults
      </button>
    </form>
  );
}
