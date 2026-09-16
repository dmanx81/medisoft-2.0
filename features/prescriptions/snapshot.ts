import type { QueryRunner } from '@/lib/db/query';
import { loadAssetForSnapshot } from '@/features/branding/repository';
import type {
  PrescriptionItem,
  PrescriptionSnapshot,
} from './types';

export function prescriptionFromSnapshot(
  snapshot: PrescriptionSnapshot,
): PrescriptionSnapshot {
  if (snapshot.schema_version !== 1)
    throw new Error('Unsupported prescription snapshot version.');
  if (!snapshot.prescription?.prescription_number)
    throw new Error('Finalized prescription snapshot is missing frozen identity.');
  return snapshot;
}

export async function buildPrescriptionSnapshot(
  db: QueryRunner,
  organizationId: string,
  input: {
    patient_id: string;
    doctor_id: string;
    prescription_number: string;
    prescription_date: string;
    clinical_note: string;
    general_instructions: string;
    finalized_at: string;
    finalized_by_name: string;
    items: PrescriptionItem[];
  },
): Promise<PrescriptionSnapshot> {
  const organization = (
    await db.query<{
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
      logo_asset_id: string;
    }>(
      `SELECT name,legal_name,type,COALESCE(address,'') AS address,city,postal_code,country,
 COALESCE(phone,'') AS phone,COALESCE(email,'') AS email,website,registration_number,
 COALESCE(logo_asset_id::text,'') AS logo_asset_id
 FROM organizations WHERE id=$1`,
      [organizationId],
    )
  ).rows[0];
  const patient = (
    await db.query<{
      patient_number: string;
      first_name: string;
      last_name: string;
      date_of_birth: string;
    }>(
      `SELECT patient_number,first_name,last_name,COALESCE(date_of_birth::text,'') AS date_of_birth
 FROM patients WHERE organization_id=$1 AND id=$2`,
      [organizationId, input.patient_id],
    )
  ).rows[0];
  const doctor = (
    await db.query<{
      display_name: string;
      title: string;
      specialty: string;
      license_number: string;
      qualifications: string;
      department: string;
      signature_asset_id: string;
    }>(
      `SELECT display_name,title,specialty,license_number,qualifications,department,
 COALESCE(signature_asset_id::text,'') AS signature_asset_id
 FROM doctors WHERE organization_id=$1 AND id=$2`,
      [organizationId, input.doctor_id],
    )
  ).rows[0];
  const logo = await loadAssetForSnapshot(
    db,
    organizationId,
    organization.logo_asset_id,
  );
  const signature = await loadAssetForSnapshot(
    db,
    organizationId,
    doctor.signature_asset_id,
  );
  return {
    schema_version: 1,
    organization: {
      name: organization.name,
      legal_name: organization.legal_name,
      type: organization.type,
      address: organization.address,
      city: organization.city,
      postal_code: organization.postal_code,
      country: organization.country,
      phone: organization.phone,
      email: organization.email,
      website: organization.website,
      registration_number: organization.registration_number,
      logo,
    },
    patient: {
      patient_number: patient.patient_number,
      first_name: patient.first_name,
      last_name: patient.last_name,
      date_of_birth: patient.date_of_birth,
    },
    doctor: {
      display_name: doctor.display_name,
      title: doctor.title,
      specialty: doctor.specialty,
      license_number: doctor.license_number,
      qualifications: doctor.qualifications,
      department: doctor.department,
      signature,
    },
    prescription: {
      prescription_number: input.prescription_number,
      prescription_date: input.prescription_date,
      clinical_note: input.clinical_note,
      general_instructions: input.general_instructions,
      finalized_at: input.finalized_at,
      finalized_by_name: input.finalized_by_name,
    },
    items: input.items.map((item) => ({
      sort_order: item.sort_order,
      medication_name: item.medication_name,
      strength: item.strength,
      form: item.form,
      dose: item.dose,
      route: item.route,
      frequency: item.frequency,
      duration: item.duration,
      quantity: item.quantity,
      instructions: item.instructions,
    })),
  };
}
