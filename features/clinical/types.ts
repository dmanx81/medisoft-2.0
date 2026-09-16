export type DoctorStatus = 'ACTIVE' | 'INACTIVE';
export type PrescriptionStatus = 'DRAFT' | 'FINALIZED' | 'CANCELLED';

export type ClinicalDoctor = {
  id: string;
  organization_id: string;
  user_id: string;
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
  status: DoctorStatus;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type ClinicalDoctorSummary = Pick<
  ClinicalDoctor,
  | 'id'
  | 'display_name'
  | 'title'
  | 'specialty'
  | 'license_number'
  | 'status'
  | 'department'
>;

export type ClinicalDoctorPage = {
  doctors: ClinicalDoctorSummary[];
  total: number;
  page: number;
  pageSize: number;
};

export type StaffLookup = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  doctor_id: string;
};

export type PrescriptionItem = {
  id: string;
  sort_order: number;
  medication_name: string;
  strength: string;
  form: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  quantity: string;
  instructions: string;
};

export type PrescriptionItemInput = Omit<PrescriptionItem, 'id' | 'sort_order'> & {
  sort_order?: number;
};

export type ClinicalPrescription = {
  id: string;
  organization_id: string;
  patient_id: string;
  doctor_id: string;
  status: PrescriptionStatus;
  prescription_number: string;
  prescribed_on: string;
  clinical_note: string;
  instructions: string;
  version: number;
  finalized_at: string;
  finalized_by: string;
  cancelled_at: string;
  cancelled_by: string;
  cancellation_reason: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  items: PrescriptionItem[];
  patient_display?: string;
  patient_number?: string;
  doctor_display?: string;
};

export type PrescriptionWorkItem = {
  id: string;
  prescription_number: string;
  status: PrescriptionStatus;
  prescribed_on: string;
  doctor_display: string;
  medication_summary: string;
  patient_id: string;
};

export type PrescriptionPage = {
  prescriptions: PrescriptionWorkItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type OrganizationBranding = {
  name: string;
  legal_name: string;
  address: string;
  city: string;
  postal_code: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  registration_number: string;
  has_logo: boolean;
};

export type PrescriptionSnapshotItem = {
  medication_name: string;
  strength: string;
  form: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  quantity: string;
  instructions: string;
};

export type PrescriptionSnapshot = {
  schema_version: 1;
  organization: {
    name: string;
    legal_name: string;
    type: string;
    address: string;
    city: string;
    postal_code: string;
    country: string;
    phone: string;
    email: string;
    website: string;
    registration_number: string;
  };
  patient: {
    patient_number: string;
    first_name: string;
    last_name: string;
    date_of_birth: string;
  };
  doctor: {
    display_name: string;
    title: string;
    specialty: string;
    license_number: string;
    department: string;
    qualifications: string;
  };
  prescription: {
    prescription_number: string;
    prescribed_on: string;
    clinical_note: string;
    instructions: string;
    finalized_at: string;
    finalized_by_name: string;
  };
  items: PrescriptionSnapshotItem[];
  logo?: { content_type: string; bytes: string };
  signature?: { content_type: string; bytes: string };
};

export class ClinicalError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
