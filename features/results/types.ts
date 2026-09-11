export type LabResult = {
  id: string;
  organization_id: string;
  order_id: string;
  order_test_id: string;
  status: string;
  result_type_snapshot: string;
  numeric_value: string;
  text_value: string;
  boolean_value: string;
  unit_symbol_snapshot: string;
  method_snapshot: string;
  flag: string;
  reference_range_id: string;
  range_version_snapshot: string;
  range_sex_snapshot: string;
  range_lower_snapshot: string;
  range_upper_snapshot: string;
  range_lower_operator_snapshot: string;
  range_upper_operator_snapshot: string;
  range_text_snapshot: string;
  range_unit_symbol_snapshot: string;
  range_method_snapshot: string;
  critical_low_snapshot: string;
  critical_high_snapshot: string;
  entered_at: string;
  entered_by: string;
  entered_by_name: string;
  technically_validated_at: string;
  technically_validated_by: string;
  technically_validated_by_name: string;
  clinically_verified_at: string;
  clinically_verified_by: string;
  clinically_verified_by_name: string;
  amendment_reason: string;
  supersedes_id: string;
  successor_id: string;
  is_current: boolean;
  version: number;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
};
export type ResultContext = {
  order_id: string;
  order_test_id: string;
  order_status: string;
  order_version: number;
  code: string;
  name: string;
  result_type: string;
  unit_symbol: string;
  method: string;
  covering_status: string;
  current: LabResult | null;
  range: {
    id: string;
    sex: string;
    age_min: string;
    age_max: string;
    age_unit: string;
    lower_bound: string;
    upper_bound: string;
    lower_operator: string;
    upper_operator: string;
    text_range: string;
    unit_symbol: string;
    method: string;
    critical_low: string;
    critical_high: string;
    range_version: string;
  } | null;
  range_reason: string;
};
export type ResultWorkItem = {
  id: string;
  order_number: string;
  status: string;
  priority: string;
  ordered_at: string;
  patient_number: string;
  patient_first_name: string;
  patient_last_name: string;
  pending_results: string;
  entered_results: string;
};
export class ResultError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
