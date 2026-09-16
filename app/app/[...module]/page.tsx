import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { navigation } from '@/components/application/navigation';
import { database } from '@/lib/db';
import { organizationScope } from '@/lib/db/tenant';
import { BillingSettingsForm } from '@/components/billing/settings';
import { BrandingForm } from '@/components/clinical/branding-form';
import { getBranding } from '@/features/clinical/branding';
import type { OrganizationBranding } from '@/features/clinical/types';
export default async function ModulePage({
  params,
}: {
  params: Promise<{ module: string[] }>;
}) {
  const principal = await requireUser();
  const { module } = await params;
  const route = navigation.find(
    (item) => item.href === `/app/${module.join('/')}`,
  );
  if (!route) notFound();
  if (!can(principal.role, route.permission))
    return (
      <section role="alert">
        <h1 className="text-2xl font-semibold">Access restricted</h1>
        <p className="mt-3 text-slate">
          Your role does not include access to this module. Contact your
          organization administrator.
        </p>
      </section>
    );
  let settings:
    | {
        name: string;
        timezone: string;
        default_language: string;
        ai_enabled: boolean;
        currency: string;
        default_tax_rate: string;
      }
    | undefined;
  let branding: OrganizationBranding | undefined;
  if (route.href === '/app/settings') {
    const scope = organizationScope(principal);
    // Organizations itself is keyed by id; all owned resources use organization_id.
    settings = (
      await database().query(
        'SELECT name,timezone,default_language,ai_enabled,currency,default_tax_rate::text FROM organizations WHERE id=$1',
        scope.values,
      )
    ).rows[0];
    branding = await getBranding(database(), principal);
  }
  return (
    <section className="max-w-4xl">
      <p className="text-sm text-teal">{route.group}</p>
      <h1 className="mt-1 text-2xl font-semibold">{route.label}</h1>
      <div className="mt-6 rounded-md border border-line bg-white p-8">
        <h2 className="font-medium">
          {settings ? 'Organization preferences' : 'Coming in a future release'}
        </h2>
        <p className="mt-2 text-sm text-slate">{route.description}</p>
        {settings && (
          <dl className="mt-6 grid gap-4 text-sm">
            {[
              ['Organization', settings.name],
              ['Timezone', settings.timezone],
              ['Default language', settings.default_language],
              ['AI assistance', settings.ai_enabled ? 'Enabled' : 'Disabled'],
              ['Billing currency', settings.currency],
              ['Default tax rate', `${settings.default_tax_rate}%`],
            ].map(([label, value]) => (
              <div
                key={label}
                className="grid grid-cols-2 border-b border-line pb-3"
              >
                <dt className="text-slate">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {branding && <BrandingForm initial={branding} />}
        {settings && can(principal.role, 'billing:settings') && (
          <BillingSettingsForm
            initial={{
              currency: settings.currency,
              default_tax_rate: settings.default_tax_rate,
            }}
          />
        )}
      </div>
    </section>
  );
}
