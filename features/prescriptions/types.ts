export type PrescriptionStatus = 'DRAFT' | 'FINALIZED' | 'CANCELLED';

export type PrescriptionItemInput = {
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

export type PrescriptionItem = PrescriptionItemInput & {
  id: string;
  organization_id: string;
  prescription_id: string;
  sort_order: number;
};

export type PrescriptionSnapshotItem = PrescriptionItemInput & {
  sort_order: number;
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
    logo: { png_base64: string; width: number; height: number } | null;
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
    qualifications: string;
    department: string;
    signature: { png_base64: string; width: number; height: number } | null;
  };
  prescription: {
    prescription_number: string;
    prescription_date: string;
    clinical_note: string;
    general_instructions: string;
    finalized_at: string;
    finalized_by_name: string;
  };
  items: PrescriptionSnapshotItem[];
};

export type Prescription = {
  id: string;
  organization_id: string;
  patient_id: string;
  doctor_id: string;
  prescription_number: string;
  status: PrescriptionStatus;
  prescription_date: string;
  clinical_note: string;
  general_instructions: string;
  finalized_at: string;
  finalized_by: string;
  finalized_by_name: string;
  cancelled_at: string;
  cancelled_by: string;
  cancelled_by_name: string;
  cancellation_reason: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  version: number;
  snapshot: PrescriptionSnapshot | Record<string, never>;
  patient_number: string;
  patient_first_name: string;
  patient_last_name: string;
  doctor_display_name: string;
  items: PrescriptionItem[];
};

export type PrescriptionSummary = {
  id: string;
  patient_id: string;
  doctor_id: string;
  prescription_number: string;
  status: PrescriptionStatus;
  prescription_date: string;
  doctor_display_name: string;
  medication_summary: string;
  created_at: string;
  finalized_at: string;
};

export type PrescriptionPage = {
  prescriptions: PrescriptionSummary[];
  total: number;
  page: number;
  pageSize: number;
};

export class PrescriptionError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
