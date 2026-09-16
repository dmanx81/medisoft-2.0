import type { QueryRunner } from '@/lib/db/query';
import type { Principal } from '@/lib/auth/permissions';
import { ClinicalError, type PrescriptionSnapshot } from './types';

export function prescriptionFromSnapshot(
  snapshot: PrescriptionSnapshot,
): PrescriptionSnapshot {
  if (snapshot.schema_version !== 1)
    throw new ClinicalError(
      500,
      'UNAVAILABLE',
      'Unsupported prescription snapshot version.',
    );
  if (!snapshot.prescription?.prescription_number || !snapshot.items?.length)
    throw new ClinicalError(
      500,
      'UNAVAILABLE',
      'Finalized prescription snapshot is missing frozen identity.',
    );
  return snapshot;
}

export async function buildPrescriptionSnapshot(
  db: QueryRunner,
  principal: Principal,
  input: {
    prescription_number: string;
    prescribed_on: string;
    clinical_note: string;
    instructions: string;
    finalized_at: string;
    finalized_by_name: string;
    patient_id: string;
    doctor_id: string;
    items: PrescriptionSnapshot['items'];
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
    }>(
      `SELECT name,legal_name,type,COALESCE(address,'') AS address,city,postal_code,country,
 COALESCE(phone,'') AS phone,COALESCE(email,'') AS email,website,registration_number
 FROM organizations WHERE id=$1`,
      [principal.organizationId],
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
      [principal.organizationId, input.patient_id],
    )
  ).rows[0];
  const doctor = (
    await db.query<{
      display_name: string;
      title: string;
      specialty: string;
      license_number: string;
      department: string;
      qualifications: string;
      signature_asset_id: string;
    }>(
      `SELECT display_name,title,specialty,license_number,department,qualifications,
 COALESCE(signature_asset_id::text,'') AS signature_asset_id
 FROM clinical_doctors WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, input.doctor_id],
    )
  ).rows[0];
  if (!organization || !patient || !doctor)
    throw new ClinicalError(404, 'NOT_FOUND', 'Prescription not found.');
  const logo = (
    await db.query<{ content_type: string; bytes: Buffer }>(
      `SELECT content_type,bytes FROM organization_assets
 WHERE organization_id=$1 AND kind='LOGO'`,
      [principal.organizationId],
    )
  ).rows[0];
  const signature = doctor.signature_asset_id
    ? (
        await db.query<{ content_type: string; bytes: Buffer }>(
          `SELECT content_type,bytes FROM organization_assets
 WHERE organization_id=$1 AND id=$2 AND kind='SIGNATURE'`,
          [principal.organizationId, doctor.signature_asset_id],
        )
      ).rows[0]
    : undefined;
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
    },
    patient,
    doctor: {
      display_name: doctor.display_name,
      title: doctor.title,
      specialty: doctor.specialty,
      license_number: doctor.license_number,
      department: doctor.department,
      qualifications: doctor.qualifications,
    },
    prescription: {
      prescription_number: input.prescription_number,
      prescribed_on: input.prescribed_on,
      clinical_note: input.clinical_note,
      instructions: input.instructions,
      finalized_at: input.finalized_at,
      finalized_by_name: input.finalized_by_name,
    },
    items: input.items,
    ...(logo
      ? {
          logo: {
            content_type: logo.content_type,
            bytes: Buffer.from(logo.bytes).toString('base64'),
          },
        }
      : {}),
    ...(signature
      ? {
          signature: {
            content_type: signature.content_type,
            bytes: Buffer.from(signature.bytes).toString('base64'),
          },
        }
      : {}),
  };
}
