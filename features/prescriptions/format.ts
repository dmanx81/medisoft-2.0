export const prescriptionStatusLabels: Record<string, string> = {
  DRAFT: 'Draft',
  FINALIZED: 'Finalized',
  CANCELLED: 'Cancelled',
};
export const prescriptionActivityLabels: Record<string, string> = {
  PRESCRIPTION_CREATED: 'Prescription draft created',
  PRESCRIPTION_UPDATED: 'Prescription draft updated',
  PRESCRIPTION_FINALIZED: 'Prescription finalized',
  PRESCRIPTION_CANCELLED: 'Prescription cancelled',
  PRESCRIPTION_DOWNLOADED: 'Prescription PDF downloaded',
};
export function medicationSummary(
  items: { medication_name: string }[],
  limit = 2,
) {
  const names = items
    .map((item) => item.medication_name.trim())
    .filter(Boolean);
  if (names.length === 0) return '';
  const shown = names.slice(0, limit).join(', ');
  return names.length > limit ? `${shown} +${names.length - limit}` : shown;
}
