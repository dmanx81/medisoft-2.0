'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { OrganizationBranding } from '@/features/clinical/types';
type Failure = { message?: string; fields?: Record<string, string> };
export function BrandingForm({
  initial,
  canEdit = true,
}: {
  initial: OrganizationBranding;
  canEdit?: boolean;
}) {
  const [values, setValues] = useState(initial);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-8 grid gap-6 border-t border-line pt-6">
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canEdit) return;
          setBusy(true);
          setFailure(null);
          setSaved(false);
          void (async () => {
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
              setValues(payload);
              setSaved(true);
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <h3 className="font-medium">Clinical document branding</h3>
        <p className="text-sm text-slate">
          These details appear on prescriptions and can be reused later for
          laboratory reports and invoices. Issued documents keep their frozen
          snapshot.
        </p>
        {failure && (
          <p className="rounded-md border border-coral/30 p-3 text-sm text-coral" role="alert">
            {failure.message || 'Branding could not be saved.'}
          </p>
        )}
        {saved && <p className="text-sm text-teal">Branding saved.</p>}
        {(
          [
            ['legal_name', 'Legal / display name'],
            ['address', 'Address'],
            ['city', 'City'],
            ['postal_code', 'Postcode'],
            ['phone', 'Telephone'],
            ['email', 'Email'],
            ['website', 'Website'],
            ['registration_number', 'Registration / license number'],
          ] as const
        ).map(([name, label]) => (
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
            />
          </label>
        ))}
        {canEdit && (
          <button
            type="submit"
            className="w-fit rounded-md bg-teal px-4 py-2 text-sm font-medium text-white"
            disabled={busy}
          >
            Save branding
          </button>
        )}
      </form>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canEdit) return;
          const data = new FormData(event.currentTarget);
          setBusy(true);
          setFailure(null);
          void (async () => {
            try {
              const response = await fetch('/api/organization/branding/logo', {
                method: 'POST',
                body: data,
              });
              const payload = (await response.json()) as Failure & OrganizationBranding;
              if (!response.ok) {
                setFailure(payload);
                return;
              }
              setValues(payload);
              setSaved(true);
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <h3 className="font-medium">Logo</h3>
        <p className="text-sm text-slate">
          PNG, JPEG or WebP, up to 256 KB and 2000×2000 pixels. The file is stored
          in the organization database, not on a public path.
        </p>
        {values.has_logo && (
          // Authenticated logo bytes cannot go through next/image optimization.
          // oxlint-disable-next-line next/no-img-element
          <img
            alt="Organization logo"
            src="/api/organization/branding/logo"
            className="h-16 w-auto"
          />
        )}
        {canEdit && (
          <>
            <label className="text-sm font-medium" htmlFor="branding-logo">
              Upload logo
              <Input
                id="branding-logo"
                className="mt-2"
                type="file"
                name="logo"
                accept="image/png,image/jpeg,image/webp"
                required
              />
            </label>
            <button
              type="submit"
              className="w-fit rounded-md border border-line px-4 py-2 text-sm"
              disabled={busy}
            >
              Upload logo
            </button>
          </>
        )}
      </form>
    </div>
  );
}
