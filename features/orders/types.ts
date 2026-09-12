import type { LabResult } from '@/features/results/types';
import type { LabReport } from '@/features/reports/types';
import type { OrderInput } from './validation';
export type LabOrderSummary = {
  id: string;
  order_number: string;
  status: string;
  priority: string;
  ordered_at: string;
  created_at: string;
  updated_at: string;
  patient_id: string;
  patient_number: string;
  patient_first_name: string;
  patient_last_name: string;
  test_count: string;
  covered_count: string;
  received_count: string;
  specimen_count: string;
};
export type LabOrderPage = {
  orders: LabOrderSummary[];
  total: number;
  page: number;
  pageSize: number;
};
export type LabOrderTest = {
  id: string;
  organization_id: string;
  order_id: string;
  lab_test_id: string;
  code_snapshot: string;
  name_snapshot: string;
  short_name_snapshot: string;
  specimen_type_snapshot: string;
  result_type_snapshot: string;
  unit_symbol_snapshot: string;
  method_snapshot: string;
  base_price_snapshot: string;
  status: string;
  created_at: string;
  created_by: string;
  covering_specimen_id: string;
  covering_status: string;
};
export type LabSpecimen = {
  id: string;
  organization_id: string;
  order_id: string;
  accession_number: string;
  specimen_type: string;
  status: string;
  collected_at: string;
  collected_by: string;
  collected_by_name: string;
  received_at: string;
  received_by: string;
  received_by_name: string;
  collection_notes: string;
  rejection_reason: string;
  rejected_at: string;
  rejected_by: string;
  rejected_by_name: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  version: number;
  order_test_ids: string[];
};
export type LabOrder = OrderInput & {
  id: string;
  organization_id: string;
  order_number: string;
  status: string;
  ordered_at: string;
  ordered_by: string;
  ordered_by_name: string;
  cancellation_reason: string;
  cancelled_at: string;
  cancelled_by: string;
  cancelled_by_name: string;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  patient_number: string;
  patient_first_name: string;
  patient_last_name: string;
  patient_status: string;
  tests: LabOrderTest[];
  specimens: LabSpecimen[];
  results: LabResult[];
  reports: LabReport[];
  test_count: number;
  covered_count: number;
  received_count: number;
};
export type LabOrderActivity = {
  id: string;
  action: string;
  occurred_at: string;
  actor: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
};
export class OrderError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
