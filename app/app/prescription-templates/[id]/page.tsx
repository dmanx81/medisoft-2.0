import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { templateForPage } from '@/services/clinical';
import { TemplateForm } from '@/components/clinical/template-form';
import { ClinicalAccessDenied } from '@/components/clinical/access';
export const metadata = {
  title: 'Prescription template — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function PrescriptionTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, 'prescription-templates:manage'))
    return <ClinicalAccessDenied module="prescription template" />;
  const template = await templateForPage(user, (await params).id);
  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/app/prescription-templates" className="text-sm text-teal">
        ← Prescription templates
      </Link>
      <header className="mb-6 mt-4">
        <h1 className="text-2xl font-semibold">{template.name}</h1>
        <p className="mt-2 text-sm text-slate">
          {template.category || 'Uncategorized'} · {template.items.length}{' '}
          {template.items.length === 1 ? 'medication' : 'medications'} ·{' '}
          {template.is_active ? 'Active' : 'Inactive'}
        </p>
      </header>
      <TemplateForm initial={template} />
    </div>
  );
}
