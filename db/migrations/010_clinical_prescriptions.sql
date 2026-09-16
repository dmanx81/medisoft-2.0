-- Clinical doctors, organization document branding and immutable prescriptions.
-- Phases 1–9 laboratory, reporting, sharing and billing semantics are unchanged.

ALTER TABLE organizations ADD COLUMN legal_name text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN city text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN postal_code text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN website text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN registration_number text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD CONSTRAINT organizations_legal_name CHECK(length(legal_name) <= 160);
ALTER TABLE organizations ADD CONSTRAINT organizations_city CHECK(length(city) <= 100);
ALTER TABLE organizations ADD CONSTRAINT organizations_postal_code CHECK(length(postal_code) <= 20);
ALTER TABLE organizations ADD CONSTRAINT organizations_website CHECK(length(website) <= 200);
ALTER TABLE organizations ADD CONSTRAINT organizations_registration CHECK(length(registration_number) <= 80);

CREATE TABLE organization_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 kind text NOT NULL CHECK(kind IN ('LOGO','SIGNATURE')),
 content_type text NOT NULL CHECK(content_type IN ('image/png','image/jpeg','image/webp')),
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 32 AND 262144),
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL,
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
);
CREATE UNIQUE INDEX organization_assets_logo ON organization_assets(organization_id) WHERE kind='LOGO';

CREATE TABLE clinical_doctors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 user_id uuid NOT NULL,
 first_name text NOT NULL CHECK(length(btrim(first_name)) BETWEEN 1 AND 100),
 last_name text NOT NULL CHECK(length(btrim(last_name)) BETWEEN 1 AND 100),
 display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 160),
 title text NOT NULL DEFAULT '' CHECK(length(title) <= 80),
 specialty text NOT NULL DEFAULT '' CHECK(length(specialty) <= 120),
 license_number text NOT NULL DEFAULT '' CHECK(length(license_number) <= 80),
 phone text NOT NULL DEFAULT '' CHECK(length(phone) <= 40),
 email text NOT NULL DEFAULT '' CHECK(length(email) <= 254),
 qualifications text NOT NULL DEFAULT '' CHECK(length(qualifications) <= 500),
 department text NOT NULL DEFAULT '' CHECK(length(department) <= 120),
 signature_asset_id uuid,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL,
 updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,user_id),
 FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,signature_asset_id) REFERENCES organization_assets(organization_id,id)
);
CREATE INDEX clinical_doctors_name ON clinical_doctors(organization_id,lower(last_name),lower(first_name),id);
CREATE INDEX clinical_doctors_status ON clinical_doctors(organization_id,status,display_name,id);
CREATE TRIGGER clinical_doctors_updated BEFORE UPDATE ON clinical_doctors
 FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE FUNCTION protect_clinical_doctor_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
  RAISE EXCEPTION 'Doctor identity is immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER clinical_doctors_identity BEFORE UPDATE ON clinical_doctors
 FOR EACH ROW EXECUTE FUNCTION protect_clinical_doctor_identity();
CREATE FUNCTION forbid_clinical_doctor_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Doctors cannot be deleted';
END;
$$;
CREATE TRIGGER clinical_doctors_no_delete BEFORE DELETE ON clinical_doctors
 FOR EACH ROW EXECUTE FUNCTION forbid_clinical_doctor_delete();

CREATE TABLE clinical_prescription_counters (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 year integer NOT NULL CHECK(year BETWEEN 2000 AND 2100),
 last_number bigint NOT NULL CHECK(last_number > 0),
 PRIMARY KEY(organization_id,year)
);

CREATE TABLE clinical_prescriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 patient_id uuid NOT NULL,
 doctor_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','FINALIZED','CANCELLED')),
 prescription_number text NOT NULL DEFAULT '' CHECK(
  prescription_number='' OR prescription_number ~ '^RX-[0-9]{4}-[0-9]{6}$'
 ),
 prescribed_on date NOT NULL DEFAULT CURRENT_DATE,
 clinical_note text NOT NULL DEFAULT '' CHECK(length(clinical_note) <= 2000),
 instructions text NOT NULL DEFAULT '' CHECK(length(instructions) <= 2000),
 snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
 finalized_at timestamptz,
 finalized_by uuid,
 cancelled_at timestamptz,
 cancelled_by uuid,
 cancellation_reason text NOT NULL DEFAULT '' CHECK(length(cancellation_reason) <= 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL,
 updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,patient_id) REFERENCES patients(organization_id,id),
 FOREIGN KEY(organization_id,doctor_id) REFERENCES clinical_doctors(organization_id,id),
 FOREIGN KEY(organization_id,finalized_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,cancelled_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id),
 CONSTRAINT clinical_prescriptions_number CHECK(
  (status='DRAFT' AND prescription_number='' AND finalized_at IS NULL AND finalized_by IS NULL)
  OR (status='FINALIZED' AND prescription_number <> '' AND finalized_at IS NOT NULL AND finalized_by IS NOT NULL)
  OR (status='CANCELLED' AND (
   (prescription_number='' AND finalized_at IS NULL AND finalized_by IS NULL)
   OR (prescription_number <> '' AND finalized_at IS NOT NULL AND finalized_by IS NOT NULL)
  ))
 ),
 CONSTRAINT clinical_prescriptions_cancelled CHECK(
  (status='CANCELLED' AND cancellation_reason <> '' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
  OR (status<>'CANCELLED' AND cancellation_reason='' AND cancelled_at IS NULL AND cancelled_by IS NULL)
 )
);
CREATE UNIQUE INDEX clinical_prescriptions_number_unique
 ON clinical_prescriptions(organization_id,prescription_number)
 WHERE prescription_number <> '';
CREATE INDEX clinical_prescriptions_patient
 ON clinical_prescriptions(organization_id,patient_id,prescribed_on DESC,id);
CREATE INDEX clinical_prescriptions_status
 ON clinical_prescriptions(organization_id,status,updated_at DESC,id);
CREATE TRIGGER clinical_prescriptions_updated BEFORE UPDATE ON clinical_prescriptions
 FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE FUNCTION protect_clinical_prescription_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
 OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
  RAISE EXCEPTION 'Prescription identity is immutable';
 END IF;
 IF OLD.status='FINALIZED' AND NEW.status='DRAFT' THEN
  RAISE EXCEPTION 'Finalized prescriptions cannot return to draft';
 END IF;
 IF OLD.status='CANCELLED' AND NEW.status IS DISTINCT FROM 'CANCELLED' THEN
  RAISE EXCEPTION 'Cancelled prescriptions cannot become active';
 END IF;
  IF OLD.status IN ('FINALIZED','CANCELLED') AND OLD.prescription_number <> '' THEN
  IF NEW.prescription_number IS DISTINCT FROM OLD.prescription_number
  OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
  OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at
  OR NEW.finalized_by IS DISTINCT FROM OLD.finalized_by
  OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
  OR NEW.prescribed_on IS DISTINCT FROM OLD.prescribed_on
  OR NEW.clinical_note IS DISTINCT FROM OLD.clinical_note
  OR NEW.instructions IS DISTINCT FROM OLD.instructions THEN
   RAISE EXCEPTION 'Finalized prescription content is immutable';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER clinical_prescriptions_identity BEFORE UPDATE ON clinical_prescriptions
 FOR EACH ROW EXECUTE FUNCTION protect_clinical_prescription_identity();
CREATE FUNCTION forbid_clinical_prescription_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Prescriptions cannot be deleted';
END;
$$;
CREATE TRIGGER clinical_prescriptions_no_delete BEFORE DELETE ON clinical_prescriptions
 FOR EACH ROW EXECUTE FUNCTION forbid_clinical_prescription_delete();

CREATE TABLE clinical_prescription_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 prescription_id uuid NOT NULL,
 sort_order integer NOT NULL CHECK(sort_order > 0),
 medication_name text NOT NULL CHECK(length(btrim(medication_name)) BETWEEN 1 AND 160),
 strength text NOT NULL DEFAULT '' CHECK(length(strength) <= 80),
 form text NOT NULL DEFAULT '' CHECK(length(form) <= 80),
 dose text NOT NULL DEFAULT '' CHECK(length(dose) <= 80),
 route text NOT NULL DEFAULT '' CHECK(length(route) <= 80),
 frequency text NOT NULL DEFAULT '' CHECK(length(frequency) <= 80),
 duration text NOT NULL DEFAULT '' CHECK(length(duration) <= 80),
 quantity text NOT NULL DEFAULT '' CHECK(length(quantity) <= 80),
 instructions text NOT NULL DEFAULT '' CHECK(length(instructions) <= 500),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,prescription_id,sort_order),
 FOREIGN KEY(organization_id,prescription_id) REFERENCES clinical_prescriptions(organization_id,id)
);
CREATE INDEX clinical_prescription_items_rx
 ON clinical_prescription_items(organization_id,prescription_id,sort_order);
CREATE FUNCTION protect_clinical_prescription_items() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 st text;
BEGIN
 IF TG_OP='DELETE' THEN
  SELECT status INTO st FROM clinical_prescriptions
   WHERE organization_id=OLD.organization_id AND id=OLD.prescription_id;
  IF st IS DISTINCT FROM 'DRAFT' THEN
   RAISE EXCEPTION 'Finalized prescription items are immutable';
  END IF;
  RETURN OLD;
 END IF;
 SELECT status INTO st FROM clinical_prescriptions
  WHERE organization_id=NEW.organization_id AND id=NEW.prescription_id;
 IF st IS DISTINCT FROM 'DRAFT' THEN
  RAISE EXCEPTION 'Finalized prescription items are immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER clinical_prescription_items_guard
 BEFORE INSERT OR UPDATE OR DELETE ON clinical_prescription_items
 FOR EACH ROW EXECUTE FUNCTION protect_clinical_prescription_items();

CREATE INDEX audit_clinical_doctors ON audit_events(organization_id,entity_type,entity_id,occurred_at DESC);
