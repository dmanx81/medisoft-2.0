import { resultFlagLabels } from '@/features/results/format';
import type { LabReportSnapshot } from './types';

export type ReportIssuance = NonNullable<LabReportSnapshot['issuance']>;

export type ClinicalResult = LabReportSnapshot['results'][number] & {
  flag_display: string;
};

export type ClinicalReport = {
  organization: LabReportSnapshot['organization'];
  patient: LabReportSnapshot['patient'];
  order: LabReportSnapshot['order'];
  specimens: LabReportSnapshot['specimens'];
  results: ClinicalResult[];
  notes: string;
  issuance: ReportIssuance & { superseded: boolean };
};

export type IssuanceFallback = Partial<ReportIssuance> & { superseded?: boolean };

function issuanceFrom(
  snapshot: LabReportSnapshot,
  fallback?: IssuanceFallback,
): ReportIssuance {
  const stored = snapshot.issuance;
  const report_number = stored?.report_number || fallback?.report_number || '';
  const report_version = stored?.report_version ?? fallback?.report_version;
  const issued_at = stored?.issued_at || fallback?.issued_at || '';
  const issued_by_name = stored?.issued_by_name || fallback?.issued_by_name || '';
  if (!report_number || report_version == null || !issued_at || !issued_by_name)
    throw new Error(
      'Issued report snapshot is missing frozen issuance identity.',
    );
  return {
    report_number,
    report_version,
    issued_at,
    issued_by_name,
  };
}

export function clinicalReportFromSnapshot(
  snapshot: LabReportSnapshot,
  fallback?: IssuanceFallback,
): ClinicalReport {
  const issuance = issuanceFrom(snapshot, fallback);
  return {
    organization: snapshot.organization,
    patient: snapshot.patient,
    order: snapshot.order,
    specimens: snapshot.specimens,
    results: snapshot.results.map((row) => ({
      ...row,
      flag_display: row.flag_display || resultFlagLabels[row.flag] || row.flag,
    })),
    notes: snapshot.order.clinical_notes || '',
    issuance: {
      ...issuance,
      superseded: fallback?.superseded ?? false,
    },
  };
}

export function attachIssuance(
  snapshot: Omit<LabReportSnapshot, 'issuance'> | LabReportSnapshot,
  issuance: ReportIssuance,
): LabReportSnapshot {
  return { ...snapshot, issuance };
}
