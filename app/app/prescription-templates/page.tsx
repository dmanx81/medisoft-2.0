import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { templatesForPage } from '@/services/clinical';
import { TemplatesList } from '@/components/clinical/templates-list';
import { ClinicalAccessDenied } from '@/components/clinical/access';
export const metadata = {
  title: 'Prescription templates — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function PrescriptionTemplatesPage() {
  const user = await requireUser();
  if (!can(user.role, 'prescription-templates:manage'))
    return <ClinicalAccessDenied module="prescription template" />;
  return (
    <TemplatesList
      initial={await templatesForPage(user)}
      canManage={can(user.role, 'prescription-templates:manage')}
    />
  );
}
