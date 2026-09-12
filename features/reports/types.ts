export type LabReportSnapshot = {
  schema_version: 1;
  organization: {
    name: string;
    slug: string;
    type: string;
    address: string;
    phone: string;
    email: string;
    country: string;
  };
  patient: {
    patient_number: string;
    first_name: string;
    last_name: string;
    date_of_birth: string;
    sex: string;
  };
  order: {
    order_number: string;
    status: string;
    priority: string;
    ordered_at: string;
    ordered_by_name: string;
    ordering_physician_name: string;
    clinical_notes: string;
    fasting_status: string;
    external_reference: string;
  };
  specimens: {
    accession_number: string;
    specimen_type: string;
    status: string;
    collected_at: string;
    collected_by_name: string;
    received_at: string;
    received_by_name: string;
  }[];
  results: {
    order_test_id: string;
    result_id: string;
    result_version: number;
    test_code: string;
    test_name: string;
    result_type: string;
    result_display: string;
    numeric_value: string;
    text_value: string;
    boolean_value: string;
    unit_symbol: string;
    method: string;
    flag: string;
    reference_range_display: string;
    range_lower: string;
    range_upper: string;
    range_text: string;
    technically_validated_at: string;
    technically_validated_by_name: string;
    clinically_verified_at: string;
    clinically_verified_by_name: string;
    is_amendment: boolean;
    amendment_reason: string;
  }[];
};
export type LabReport = {
  id: string;
  organization_id: string;
  order_id: string;
  patient_id: string;
  report_number: string;
  report_version: number;
  status: string;
  issued_at: string;
  issued_by: string;
  issued_by_name: string;
  supersedes_id: string;
  successor_id: string;
  is_current: boolean;
  version: number;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
};
export type ReportCompletionBlock = {
  order_test_id: string;
  code: string;
  name: string;
  reason: 'NO_RESULT' | 'NOT_VERIFIED';
};
export type ReportContext = {
  order_id: string;
  order_status: string;
  order_version: number;
  complete: boolean;
  eligible: boolean;
  needs_new_report: boolean;
  blocking: ReportCompletionBlock[];
  current_report: LabReport | null;
  reports: LabReport[];
};
export type ReportWorkItem = {
  id: string;
  report_number: string;
  report_version: number;
  status: string;
  issued_at: string;
  issued_by_name: string;
  is_current: boolean;
  order_id: string;
  order_number: string;
  order_status: string;
  patient_number: string;
  patient_first_name: string;
  patient_last_name: string;
};
export type ReportDelivery = {
  id: string;
  organization_id: string;
  report_id: string;
  method: string;
  recipient_descriptor: string;
  notes: string;
  status: string;
  failure_reason: string;
  delivered_at: string;
  delivered_by: string;
  delivered_by_name: string;
  created_at: string;
};
export class ReportError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
