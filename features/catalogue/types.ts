import type { CatalogueInput, RangeInput } from './validation';
export type LabCategory = {
  id: string;
  code: string;
  name: string;
  display_order: number;
  is_active: boolean;
};
export type LabUnit = {
  id: string;
  code: string;
  symbol: string;
  name: string;
};
export type LabTest = CatalogueInput & {
  id: string;
  organization_id: string;
  category_name: string;
  category_code: string;
  unit_symbol: string;
  unit_name: string;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};
export type LabTestSummary = Pick<
  LabTest,
  | 'id'
  | 'code'
  | 'name'
  | 'short_name'
  | 'category_id'
  | 'category_name'
  | 'specimen_type'
  | 'result_type'
  | 'unit_id'
  | 'unit_symbol'
  | 'is_active'
  | 'display_order'
  | 'updated_at'
>;
export type LabTestPage = {
  tests: LabTestSummary[];
  total: number;
  page: number;
  pageSize: number;
};
export type LabRange = RangeInput & {
  id: string;
  organization_id: string;
  test_id: string;
  unit_symbol: string;
  is_active: boolean;
  range_version: number;
  supersedes_id: string;
  successor_id: string;
  created_by: string;
  created_at: string;
  retired_at: string;
  retired_by: string;
  valid_to: string;
  version: number;
};
export type CatalogueLookups = {
  categories: LabCategory[];
  units: LabUnit[];
};
export class CatalogueError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
