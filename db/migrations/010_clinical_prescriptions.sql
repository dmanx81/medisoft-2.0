-- Clinical doctors, prescriptions, organization branding and A5 document assets.
-- Phases 1–9 laboratory/report/share/billing semantics are unchanged.
-- Migrations 001–009 are not modified.

ALTER TABLE organizations ADD COLUMN legal_name text NOT NULL DEFAULT ''
 CHECK(length(legal_name) <= 160);
ALTER TABLE organizations ADD COLUMN city text NOT NULL DEFAULT ''
 CHECK(length(city) <= 80);
ALTER TABLE organizations ADD COLUMN postal_code text NOT NULL DEFAULT ''
 CHECK(length(postal_code) <= 20);
ALTER TABLE organizations ADD COLUMN website text NOT NULL DEFAULT ''
 CHECK(length(website) <= 200);
ALTER TABLE organizations ADD COLUMN registration_number text NOT NULL DEFAULT ''
 CHECK(length(registration_number) <= 80);

CREATE TABLE organization_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 kind text NOT NULL CHECK(kind IN ('LOGO','DOCTOR_SIGNATURE')),
 content_type text NOT NULL CHECK(content_type IN ('image/png')),
 bytes bytea NOT NULL,
 byte_size integer NOT NULL CHECK(byte_size > 0 AND byte_size <= 2097152),
 width integer NOT NULL CHECK(width BETWEEN 16 AND 4000),
 height integer NOT NULL CHECK(height BETWEEN 16 AND 4000),
 original_filename text NOT NULL DEFAULT '' CHECK(length(original_filename) <= 160),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL,
 updated_by uuid NOT NULL,
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id),
 CONSTRAINT organization_assets_size CHECK(octet_length(bytes)=byte_size)
);
CREATE UNIQUE INDEX organization_assets_logo
 ON organization_assets(organization_id) WHERE kind='LOGO';
CREATE INDEX organization_assets_kind ON organization_assets(organization_id,kind);
CREATE TRIGGER organization_assets_updated BEFORE UPDATE ON organization_assets
 FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE FUNCTION protect_organization_asset_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR NEW.created_by IS DISTINCT FROM OLD.created_by
 THEN RAISE EXCEPTION 'Organization asset identity is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER organization_assets_identity BEFORE UPDATE ON organization_assets
 FOR EACH ROW EXECUTE FUNCTION protect_organization_asset_identity();

ALTER TABLE organizations ADD COLUMN logo_asset_id uuid;
ALTER TABLE organizations ADD CONSTRAINT organizations_logo_asset
 FOREIGN KEY(id,logo_asset_id) REFERENCES organization_assets(organization_id,id);

CREATE TABLE doctors (
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
 FOREIGN KEY(organization_id,signature_asset_id) REFERENCES organization_assets(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id)
);
CREATE INDEX doctors_name ON doctors(organization_id,lower(last_name),lower(first_name),id);
CREATE INDEX doctors_status ON doctors(organization_id,status);
CREATE INDEX doctors_updated ON doctors(organization_id,updated_at DESC,id);
CREATE TRIGGER doctors_updated BEFORE UPDATE ON doctors
 FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE FUNCTION protect_doctor_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR NEW.created_by IS DISTINCT FROM OLD.created_by
 THEN RAISE EXCEPTION 'Doctor identity is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER doctors_identity BEFORE UPDATE ON doctors
 FOR EACH ROW EXECUTE FUNCTION protect_doctor_identity();
CREATE TRIGGER doctors_no_delete BEFORE DELETE ON doctors
 FOR EACH ROW EXECUTE FUNCTION forbid_lab_order_delete();

CREATE TABLE prescription_counters (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 year integer NOT NULL CHECK(year BETWEEN 2000 AND 2100),
 last_number bigint NOT NULL CHECK(last_number > 0),
 PRIMARY KEY(organization_id, year)
);

CREATE TABLE prescriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 patient_id uuid NOT NULL,
 doctor_id uuid NOT NULL,
 prescription_number text NOT NULL DEFAULT '' CHECK(
  prescription_number='' OR prescription_number ~ '^RX-[0-9]{4}-[0-9]{6}$'
 ),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','FINALIZED','CANCELLED')),
 prescription_date date NOT NULL DEFAULT CURRENT_DATE,
 clinical_note text NOT NULL DEFAULT '' CHECK(length(clinical_note) <= 2000),
 general_instructions text NOT NULL DEFAULT '' CHECK(length(general_instructions) <= 2000),
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
 FOREIGN KEY(organization_id,doctor_id) REFERENCES doctors(organization_id,id),
 FOREIGN KEY(organization_id,finalized_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,cancelled_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id),
 CONSTRAINT prescriptions_status CHECK(
  (status='DRAFT' AND prescription_number='' AND finalized_at IS NULL AND finalized_by IS NULL
   AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason='')
  OR (status='FINALIZED' AND prescription_number <> '' AND finalized_at IS NOT NULL
   AND finalized_by IS NOT NULL AND cancelled_at IS NULL AND cancelled_by IS NULL
   AND cancellation_reason='')
  OR (status='CANCELLED' AND cancellation_reason <> '' AND cancelled_at IS NOT NULL
   AND cancelled_by IS NOT NULL AND (
    (prescription_number='' AND finalized_at IS NULL AND finalized_by IS NULL)
    OR (prescription_number <> '' AND finalized_at IS NOT NULL AND finalized_by IS NOT NULL)
   ))
 )
);
CREATE UNIQUE INDEX prescriptions_number_unique
 ON prescriptions(organization_id,prescription_number) WHERE prescription_number <> '';
CREATE INDEX prescriptions_patient ON prescriptions(organization_id,patient_id,created_at DESC,id);
CREATE INDEX prescriptions_doctor ON prescriptions(organization_id,doctor_id,created_at DESC);
CREATE INDEX prescriptions_status ON prescriptions(organization_id,status,created_at DESC);
CREATE INDEX prescriptions_issued ON prescriptions(organization_id,finalized_at DESC,id);
CREATE TRIGGER prescriptions_updated BEFORE UPDATE ON prescriptions
 FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE FUNCTION protect_prescription_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR NEW.created_by IS DISTINCT FROM OLD.created_by
 THEN RAISE EXCEPTION 'Prescription identity is immutable'; END IF;
 IF OLD.status <> 'DRAFT' THEN
  IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
  OR NEW.prescription_number IS DISTINCT FROM OLD.prescription_number
  OR NEW.prescription_date IS DISTINCT FROM OLD.prescription_date
  OR NEW.clinical_note IS DISTINCT FROM OLD.clinical_note
  OR NEW.general_instructions IS DISTINCT FROM OLD.general_instructions
  OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
  OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at
  OR NEW.finalized_by IS DISTINCT FROM OLD.finalized_by
  THEN RAISE EXCEPTION 'Finalized prescription content is immutable'; END IF;
 END IF;
 IF OLD.cancelled_at IS NOT NULL AND (
  NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
  OR NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason OR NEW.status <> 'CANCELLED'
 ) THEN RAISE EXCEPTION 'Prescription cancellation is immutable'; END IF;
 IF OLD.status='CANCELLED' AND NEW.status IS DISTINCT FROM OLD.status
 THEN RAISE EXCEPTION 'Cancelled prescriptions cannot change status'; END IF;
 IF OLD.status='FINALIZED' AND NEW.status NOT IN ('FINALIZED','CANCELLED')
 THEN RAISE EXCEPTION 'Finalized prescriptions cannot return to draft'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER prescriptions_identity BEFORE UPDATE ON prescriptions
 FOR EACH ROW EXECUTE FUNCTION protect_prescription_identity();
CREATE TRIGGER prescriptions_no_delete BEFORE DELETE ON prescriptions
 FOR EACH ROW EXECUTE FUNCTION forbid_lab_order_delete();

CREATE TABLE prescription_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 prescription_id uuid NOT NULL,
 sort_order integer NOT NULL CHECK(sort_order >= 0),
 medication_name text NOT NULL CHECK(length(btrim(medication_name)) BETWEEN 1 AND 200),
 strength text NOT NULL DEFAULT '' CHECK(length(strength) <= 80),
 form text NOT NULL DEFAULT '' CHECK(length(form) <= 80),
 dose text NOT NULL DEFAULT '' CHECK(length(dose) <= 80),
 route text NOT NULL DEFAULT '' CHECK(length(route) <= 80),
 frequency text NOT NULL DEFAULT '' CHECK(length(frequency) <= 80),
 duration text NOT NULL DEFAULT '' CHECK(length(duration) <= 80),
 quantity text NOT NULL DEFAULT '' CHECK(length(quantity) <= 80),
 instructions text NOT NULL DEFAULT '' CHECK(length(instructions) <= 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,prescription_id,sort_order),
 FOREIGN KEY(organization_id,prescription_id) REFERENCES prescriptions(organization_id,id)
);
CREATE INDEX prescription_items_prescription
 ON prescription_items(organization_id,prescription_id,sort_order,id);
CREATE TRIGGER prescription_items_updated BEFORE UPDATE ON prescription_items
 FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE FUNCTION protect_prescription_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 IF TG_OP='DELETE' THEN
  SELECT status INTO st FROM prescriptions
   WHERE organization_id=OLD.organization_id AND id=OLD.prescription_id;
  IF st IS DISTINCT FROM 'DRAFT' THEN
   RAISE EXCEPTION 'Finalized prescription items are immutable';
  END IF;
  RETURN OLD;
 END IF;
 SELECT status INTO st FROM prescriptions
  WHERE organization_id=NEW.organization_id AND id=NEW.prescription_id;
 IF st IS DISTINCT FROM 'DRAFT' THEN
  RAISE EXCEPTION 'Finalized prescription items are immutable';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
  OR NEW.prescription_id IS DISTINCT FROM OLD.prescription_id
  THEN RAISE EXCEPTION 'Prescription item identity is immutable'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER prescription_items_protect BEFORE INSERT OR UPDATE OR DELETE ON prescription_items
 FOR EACH ROW EXECUTE FUNCTION protect_prescription_item();

CREATE INDEX audit_doctors ON audit_events(organization_id,entity_type,entity_id,occurred_at DESC);
CREATE INDEX audit_prescriptions ON audit_events(organization_id,entity_type,entity_id,occurred_at DESC);
