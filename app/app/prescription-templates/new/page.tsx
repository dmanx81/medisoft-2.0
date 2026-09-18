import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { TemplateForm } from '@/components/clinical/template-form';
import { ClinicalAccessDenied } from '@/components/clinical/access';
export const metadata = {
  title: 'New prescription template — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function NewPrescriptionTemplatePage() {
  const user = await requireUser();
  if (!can(user.role, 'prescription-templates:manage'))
    return <ClinicalAccessDenied module="prescription template" />;
  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/app/prescription-templates" className="text-sm text-teal">
        ← Prescription templates
      </Link>
      <h1 className="mb-6 mt-4 text-2xl font-semibold">New template</h1>
      <TemplateForm />
    </div>
  );
}
