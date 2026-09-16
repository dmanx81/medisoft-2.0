import type { PrescriptionStatus } from './types';

export const doctorStatusLabels: Record<'ACTIVE' | 'INACTIVE', string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const prescriptionStatusLabels: Record<PrescriptionStatus, string> = {
  DRAFT: 'Draft',
  FINALIZED: 'Finalized',
  CANCELLED: 'Cancelled',
};

export const clinicalAuditLabels: Record<string, string> = {
  CLINICAL_DOCTOR_CREATED: 'Doctor profile created',
  CLINICAL_DOCTOR_UPDATED: 'Doctor profile updated',
  CLINICAL_DOCTOR_ACTIVATED: 'Doctor activated',
  CLINICAL_DOCTOR_DEACTIVATED: 'Doctor deactivated',
  CLINICAL_DOCTOR_SIGNATURE_UPDATED: 'Doctor signature updated',
  CLINICAL_PRESCRIPTION_CREATED: 'Prescription draft created',
  CLINICAL_PRESCRIPTION_UPDATED: 'Prescription draft updated',
  CLINICAL_PRESCRIPTION_FINALIZED: 'Prescription finalized',
  CLINICAL_PRESCRIPTION_CANCELLED: 'Prescription cancelled',
  CLINICAL_PRESCRIPTION_DOWNLOADED: 'Prescription PDF downloaded',
  ORGANIZATION_BRANDING_UPDATED: 'Organization branding updated',
  ORGANIZATION_LOGO_UPDATED: 'Organization logo updated',
};

export function medicationSummary(
  items: { medication_name: string }[],
  limit = 3,
) {
  const names = items.map((item) => item.medication_name).filter(Boolean);
  if (!names.length) return 'No medications';
  const shown = names.slice(0, limit).join(', ');
  return names.length > limit ? `${shown} +${names.length - limit}` : shown;
}
