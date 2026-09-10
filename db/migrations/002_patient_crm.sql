-- Patient identity is the UUID. The display number is unique only within a tenant.
CREATE TABLE patient_counters (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id),
 last_number bigint NOT NULL CHECK(last_number > 0)
);
CREATE TABLE patients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 patient_number text NOT NULL,
 first_name text NOT NULL CHECK(length(btrim(first_name)) BETWEEN 1 AND 100),
 last_name text NOT NULL CHECK(length(btrim(last_name)) BETWEEN 1 AND 100),
 date_of_birth date CHECK(date_of_birth >= DATE '1850-01-01'),
 sex text NOT NULL DEFAULT 'UNKNOWN' CHECK(sex IN ('UNKNOWN','FEMALE','MALE','INTERSEX')),
 national_id text CHECK(length(national_id) <= 64),
 national_id_key text GENERATED ALWAYS AS (nullif(upper(regexp_replace(national_id,'[^a-zA-Z0-9]','','g')),'')) STORED,
 phone text, secondary_phone text, email text,
 phone_key text GENERATED ALWAYS AS (nullif(regexp_replace(phone,'[^0-9]','','g'),'')) STORED,
 address_line_1 text, address_line_2 text, city text, postal_code text, country text,
 emergency_contact_name text, emergency_contact_phone text,
 notes text CHECK(length(notes) <= 4000),
 preferred_language text NOT NULL DEFAULT 'sq' CHECK(preferred_language IN ('en','sq')),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL, updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(organization_id,id), UNIQUE(organization_id,patient_number),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id)
);
CREATE UNIQUE INDEX patients_national_id_unique ON patients(organization_id,national_id_key) WHERE national_id_key IS NOT NULL;
CREATE INDEX patients_name ON patients(organization_id,lower(last_name),lower(first_name),id);
CREATE INDEX patients_identity_match ON patients(organization_id,lower(first_name),lower(last_name),date_of_birth);
CREATE INDEX patients_phone ON patients(organization_id,phone_key) WHERE phone_key IS NOT NULL;
CREATE INDEX patients_email ON patients(organization_id,lower(email)) WHERE email IS NOT NULL;
CREATE INDEX patients_updated ON patients(organization_id,updated_at DESC,id);
CREATE INDEX patients_status ON patients(organization_id,status);
CREATE TRIGGER patients_updated BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
-- Application updates never change ownership/creation identity. Enforce that in SQL too.
CREATE FUNCTION protect_patient_identity() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.patient_number IS DISTINCT FROM OLD.patient_number OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN RAISE EXCEPTION 'Patient identity is immutable'; END IF;
 RETURN NEW;
 END;
$$;
CREATE TRIGGER patients_identity BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION protect_patient_identity();
CREATE INDEX audit_patient_activity ON audit_events(organization_id,entity_type,entity_id,occurred_at DESC);
