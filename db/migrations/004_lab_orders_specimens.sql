-- Laboratory orders, ordered-test snapshots, specimens and specimen-test links.
CREATE TABLE lab_order_counters (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 year integer NOT NULL CHECK(year BETWEEN 2000 AND 2100),
 last_number bigint NOT NULL CHECK(last_number > 0),
 PRIMARY KEY(organization_id, year)
);
CREATE TABLE lab_accession_counters (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 year integer NOT NULL CHECK(year BETWEEN 2000 AND 2100),
 last_number bigint NOT NULL CHECK(last_number > 0),
 PRIMARY KEY(organization_id, year)
);

CREATE TABLE lab_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 patient_id uuid NOT NULL,
 order_number text NOT NULL CHECK(order_number ~ '^LAB-[0-9]{4}-[0-9]{6}$'),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN
  ('DRAFT','ORDERED','PARTIALLY_COLLECTED','COLLECTED','RECEIVED','CANCELLED')),
 priority text NOT NULL DEFAULT 'ROUTINE' CHECK(priority IN ('ROUTINE','URGENT')),
 ordered_at timestamptz,
 ordered_by uuid,
 ordering_physician_name text NOT NULL DEFAULT '' CHECK(length(ordering_physician_name) <= 160),
 clinical_notes text NOT NULL DEFAULT '' CHECK(length(clinical_notes) <= 4000),
 fasting_status text NOT NULL DEFAULT 'UNKNOWN' CHECK(fasting_status IN
  ('UNKNOWN','FASTING','NON_FASTING')),
 external_reference text NOT NULL DEFAULT '' CHECK(length(external_reference) <= 80),
 cancellation_reason text NOT NULL DEFAULT '' CHECK(length(cancellation_reason) <= 500),
 cancelled_at timestamptz,
 cancelled_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL, updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(organization_id,id), UNIQUE(organization_id,order_number),
 FOREIGN KEY(organization_id,patient_id) REFERENCES patients(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,ordered_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,cancelled_by) REFERENCES users(organization_id,id),
 CONSTRAINT lab_orders_placed CHECK(
  (status='DRAFT' AND ordered_at IS NULL AND ordered_by IS NULL)
  OR (status IN ('ORDERED','PARTIALLY_COLLECTED','COLLECTED','RECEIVED')
      AND ordered_at IS NOT NULL AND ordered_by IS NOT NULL)
  OR status='CANCELLED'
 ),
 CONSTRAINT lab_orders_cancelled CHECK(
  (status='CANCELLED' AND cancellation_reason <> '' AND cancelled_at IS NOT NULL
   AND cancelled_by IS NOT NULL)
  OR (status<>'CANCELLED' AND cancellation_reason = '' AND cancelled_at IS NULL
      AND cancelled_by IS NULL)
 )
);
CREATE INDEX lab_orders_patient ON lab_orders(organization_id,patient_id,updated_at DESC);
CREATE INDEX lab_orders_status ON lab_orders(organization_id,status,updated_at DESC);
CREATE INDEX lab_orders_ordered ON lab_orders(organization_id,ordered_at DESC,id);
CREATE INDEX lab_orders_updated ON lab_orders(organization_id,updated_at DESC,id);
CREATE INDEX lab_orders_number ON lab_orders(organization_id,order_number);
CREATE TRIGGER lab_orders_updated BEFORE UPDATE ON lab_orders
 FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE FUNCTION protect_lab_order_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.order_number IS DISTINCT FROM OLD.order_number
 OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by
 THEN RAISE EXCEPTION 'Laboratory order identity is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER lab_orders_identity BEFORE UPDATE ON lab_orders
 FOR EACH ROW EXECUTE FUNCTION protect_lab_order_identity();
CREATE FUNCTION forbid_lab_order_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Laboratory clinical records are not deleted';
END;
$$;
CREATE TRIGGER lab_orders_no_delete BEFORE DELETE ON lab_orders
 FOR EACH ROW EXECUTE FUNCTION forbid_lab_order_delete();

CREATE TABLE lab_order_tests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 order_id uuid NOT NULL,
 lab_test_id uuid NOT NULL,
 code_snapshot text NOT NULL CHECK(length(btrim(code_snapshot)) BETWEEN 1 AND 32),
 name_snapshot text NOT NULL CHECK(length(btrim(name_snapshot)) BETWEEN 1 AND 160),
 short_name_snapshot text NOT NULL DEFAULT '' CHECK(length(short_name_snapshot) <= 40),
 specimen_type_snapshot text NOT NULL CHECK(specimen_type_snapshot IN
  ('SERUM','PLASMA','WHOLE_BLOOD','URINE','STOOL','SWAB','SPUTUM','OTHER')),
 result_type_snapshot text NOT NULL CHECK(result_type_snapshot IN
  ('NUMERIC','TEXT','BOOLEAN','CATEGORICAL')),
 unit_symbol_snapshot text NOT NULL DEFAULT '' CHECK(length(unit_symbol_snapshot) <= 32),
 method_snapshot text NOT NULL DEFAULT '' CHECK(length(method_snapshot) <= 120),
 base_price_snapshot numeric(12,2) CHECK(base_price_snapshot IS NULL OR base_price_snapshot >= 0),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL,
 UNIQUE(organization_id,id), UNIQUE(organization_id,order_id,id),
 UNIQUE(organization_id,order_id,lab_test_id),
 FOREIGN KEY(organization_id,order_id) REFERENCES lab_orders(organization_id,id),
 FOREIGN KEY(organization_id,lab_test_id) REFERENCES lab_tests(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
);
CREATE INDEX lab_order_tests_order ON lab_order_tests(organization_id,order_id);
CREATE INDEX lab_order_tests_test ON lab_order_tests(organization_id,lab_test_id);
CREATE FUNCTION protect_lab_order_test_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.lab_test_id IS DISTINCT FROM OLD.lab_test_id
 OR NEW.code_snapshot IS DISTINCT FROM OLD.code_snapshot
 OR NEW.name_snapshot IS DISTINCT FROM OLD.name_snapshot
 OR NEW.short_name_snapshot IS DISTINCT FROM OLD.short_name_snapshot
 OR NEW.specimen_type_snapshot IS DISTINCT FROM OLD.specimen_type_snapshot
 OR NEW.result_type_snapshot IS DISTINCT FROM OLD.result_type_snapshot
 OR NEW.unit_symbol_snapshot IS DISTINCT FROM OLD.unit_symbol_snapshot
 OR NEW.method_snapshot IS DISTINCT FROM OLD.method_snapshot
 OR NEW.base_price_snapshot IS DISTINCT FROM OLD.base_price_snapshot
 OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by
 THEN RAISE EXCEPTION 'Ordered test snapshots are immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER lab_order_tests_snapshot BEFORE UPDATE ON lab_order_tests
 FOR EACH ROW EXECUTE FUNCTION protect_lab_order_test_snapshot();

CREATE TABLE lab_specimens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 order_id uuid NOT NULL,
 accession_number text NOT NULL CHECK(accession_number ~ '^ACC-[0-9]{4}-[0-9]{6}$'),
 specimen_type text NOT NULL CHECK(specimen_type IN
  ('SERUM','PLASMA','WHOLE_BLOOD','URINE','STOOL','SWAB','SPUTUM','OTHER')),
 status text NOT NULL DEFAULT 'COLLECTED' CHECK(status IN
  ('COLLECTED','RECEIVED','REJECTED','CANCELLED')),
 collected_at timestamptz NOT NULL,
 collected_by uuid NOT NULL,
 received_at timestamptz,
 received_by uuid,
 collection_notes text NOT NULL DEFAULT '' CHECK(length(collection_notes) <= 2000),
 rejection_reason text NOT NULL DEFAULT '' CHECK(length(rejection_reason) <= 500),
 rejected_at timestamptz,
 rejected_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL, updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(organization_id,id), UNIQUE(organization_id,order_id,id),
 UNIQUE(organization_id,accession_number),
 FOREIGN KEY(organization_id,order_id) REFERENCES lab_orders(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,collected_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,received_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,rejected_by) REFERENCES users(organization_id,id),
 CONSTRAINT lab_specimens_rejected CHECK(
  (status='REJECTED' AND rejection_reason <> '' AND rejected_at IS NOT NULL
   AND rejected_by IS NOT NULL)
  OR (status<>'REJECTED' AND rejection_reason = '' AND rejected_at IS NULL
      AND rejected_by IS NULL)
 ),
 CONSTRAINT lab_specimens_received CHECK(
  (status='RECEIVED' AND received_at IS NOT NULL AND received_by IS NOT NULL)
  OR status IN ('COLLECTED','REJECTED','CANCELLED')
 ),
 CONSTRAINT lab_specimens_collected_receipt CHECK(
  status<>'COLLECTED' OR (received_at IS NULL AND received_by IS NULL)
 )
);
CREATE INDEX lab_specimens_order ON lab_specimens(organization_id,order_id);
CREATE INDEX lab_specimens_status ON lab_specimens(organization_id,status);
CREATE INDEX lab_specimens_accession ON lab_specimens(organization_id,accession_number);
CREATE TRIGGER lab_specimens_updated BEFORE UPDATE ON lab_specimens
 FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE FUNCTION protect_lab_specimen_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.order_id IS DISTINCT FROM OLD.order_id
 OR NEW.accession_number IS DISTINCT FROM OLD.accession_number
 OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by
 THEN RAISE EXCEPTION 'Laboratory specimen identity is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER lab_specimens_identity BEFORE UPDATE ON lab_specimens
 FOR EACH ROW EXECUTE FUNCTION protect_lab_specimen_identity();
CREATE TRIGGER lab_specimens_no_delete BEFORE DELETE ON lab_specimens
 FOR EACH ROW EXECUTE FUNCTION forbid_lab_order_delete();

CREATE TABLE lab_specimen_tests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 order_id uuid NOT NULL,
 specimen_id uuid NOT NULL,
 order_test_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL,
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,specimen_id,order_test_id),
 FOREIGN KEY(organization_id,order_id,specimen_id)
  REFERENCES lab_specimens(organization_id,order_id,id),
 FOREIGN KEY(organization_id,order_id,order_test_id)
  REFERENCES lab_order_tests(organization_id,order_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
);
CREATE INDEX lab_specimen_tests_specimen ON lab_specimen_tests(organization_id,specimen_id);
CREATE INDEX lab_specimen_tests_order_test ON lab_specimen_tests(organization_id,order_test_id);
CREATE INDEX lab_specimen_tests_order ON lab_specimen_tests(organization_id,order_id);
CREATE TRIGGER lab_specimen_tests_no_delete BEFORE DELETE ON lab_specimen_tests
 FOR EACH ROW EXECUTE FUNCTION forbid_lab_order_delete();

CREATE INDEX audit_lab_orders ON audit_events(organization_id,entity_type,entity_id,occurred_at DESC);
