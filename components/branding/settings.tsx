'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { OrganizationBranding } from '@/features/branding/types';
type Failure = { code?: string; message?: string; fields?: Record<string, string> };
export function BrandingSettingsForm({
  initial,
  canEdit,
}: {
  initial: OrganizationBranding;
  canEdit: boolean;
}) {
  const [branding, setBranding] = useState(initial);
  const [values, setValues] = useState({
    name: initial.name,
    legal_name: initial.legal_name,
    address: initial.address,
    city: initial.city,
    postal_code: initial.postal_code,
    country: initial.country,
    phone: initial.phone,
    email: initial.email,
    website: initial.website,
    registration_number: initial.registration_number,
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saved, setSaved] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    setSaved(false);
    try {
      const response = await fetch('/api/organization/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
        cache: 'no-store',
      });
      const payload = (await response.json()) as Failure & OrganizationBranding;
      if (!response.ok) {
        setFailure(payload);
        return;
      }
      setBranding(payload);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }
  async function uploadLogo(file: File) {
    setBusy(true);
    setFailure(null);
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch('/api/organization/branding/logo', {
        method: 'PUT',
        body: form,
        cache: 'no-store',
      });
      const payload = (await response.json()) as Failure & OrganizationBranding;
      if (!response.ok) {
        setFailure(payload);
        return;
      }
      setBranding(payload);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }
  const fields: Array<[keyof typeof values, string]> = [
    ['name', 'Organization name'],
    ['legal_name', 'Legal / display name for documents'],
    ['address', 'Address'],
    ['city', 'City'],
    ['postal_code', 'Postcode'],
    ['country', 'Country code'],
    ['phone', 'Telephone'],
    ['email', 'Email'],
    ['website', 'Website'],
    ['registration_number', 'Registration / license number'],
  ];
  return (
    <form className="mt-8 grid gap-3 border-t border-line pt-6" onSubmit={(event) => void save(event)}>
      <h3 className="font-medium">Clinical document branding</h3>
      <p className="text-sm text-slate">
        These details appear on new prescriptions and are designed for later
        reuse on reports, invoices and certificates. Finalized documents keep
        the branding captured at issuance.
      </p>
      {failure && (
        <p className="rounded-md border border-coral/30 bg-white p-3 text-sm text-coral" role="alert">
          {failure.message || 'Branding could not be saved.'}
        </p>
      )}
      {saved && <p className="text-sm text-teal">Organization branding saved.</p>}
      {fields.map(([name, label]) => (
        <label key={name} className="text-sm font-medium" htmlFor={`branding-${name}`}>
          {label}
          <Input
            id={`branding-${name}`}
            className="mt-2"
            value={values[name]}
            onChange={(event) =>
              setValues((current) => ({ ...current, [name]: event.target.value }))
            }
            disabled={!canEdit}
            required={name === 'name' || name === 'country'}
          />
        </label>
      ))}
      {canEdit && (
        <>
          <label className="text-sm font-medium" htmlFor="branding-logo">
            Logo
            <Input
              id="branding-logo"
              className="mt-2"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadLogo(file);
              }}
            />
          </label>
          {branding.has_logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="Organization logo"
              src="/api/organization/branding/logo"
              className="h-16 w-auto"
            />
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-fit rounded-md bg-teal px-4 py-2 text-sm text-white"
          >
            Save branding
          </button>
        </>
      )}
    </form>
  );
}
