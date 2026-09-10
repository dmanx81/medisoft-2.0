import type { PatientInput } from './validation';
export type Patient = PatientInput & {
  id: string;
  organization_id: string;
  patient_number: string;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};
export type PatientSummary = Pick<
  Patient,
  | 'id'
  | 'patient_number'
  | 'first_name'
  | 'last_name'
  | 'date_of_birth'
  | 'phone'
  | 'email'
  | 'status'
  | 'updated_at'
>;
export type DuplicateMatch = Pick<
  Patient,
  'id' | 'patient_number' | 'first_name' | 'last_name' | 'date_of_birth'
> & { reasons: string[]; exactNationalId: boolean };
export type PatientPage = {
  patients: PatientSummary[];
  total: number;
  page: number;
  pageSize: number;
};
export type PatientActivity = {
  id: string;
  action: string;
  occurred_at: string;
  actor: string;
  metadata: { fields?: string[] };
};
export class PatientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
    public duplicates: DuplicateMatch[] = [],
  ) {
    super(message);
  }
}
