export type DoctorStatus = 'ACTIVE' | 'INACTIVE';

export type Doctor = {
  id: string;
  organization_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_role: string;
  user_status: string;
  first_name: string;
  last_name: string;
  display_name: string;
  title: string;
  specialty: string;
  license_number: string;
  phone: string;
  email: string;
  qualifications: string;
  department: string;
  signature_asset_id: string;
  has_signature: boolean;
  status: DoctorStatus;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
};

export type DoctorSummary = Pick<
  Doctor,
  | 'id'
  | 'display_name'
  | 'title'
  | 'specialty'
  | 'license_number'
  | 'status'
  | 'user_name'
  | 'updated_at'
>;

export type DoctorPage = {
  doctors: DoctorSummary[];
  total: number;
  page: number;
  pageSize: number;
};

export type StaffCandidate = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
};

export class DoctorError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
