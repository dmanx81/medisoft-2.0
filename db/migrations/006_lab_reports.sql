-- Order completion, issued laboratory reports, frozen snapshots and delivery records.
-- Phase 5 order statuses gain COMPLETED once every active ordered test is clinically verified.
ALTER TABLE lab_orders DROP CONSTRAINT lab_orders_status_check;
ALTER TABLE lab_orders ADD CONSTRAINT lab_orders_status_check CHECK(status IN
 ('DRAFT','ORDERED','PARTIALLY_COLLECTED','COLLECTED','RECEIVED','IN_PROCESS','COMPLETED','CANCELLED'));
ALTER TABLE lab_orders DROP CONSTRAINT lab_orders_placed;
ALTER TABLE lab_orders ADD CONSTRAINT lab_orders_placed CHECK(
 (status='DRAFT' AND ordered_at IS NULL AND ordered_by IS NULL)
 OR (status IN ('ORDERED','PARTIALLY_COLLECTED','COLLECTED','RECEIVED','IN_PROCESS','COMPLETED')
    AND ordered_at IS NOT NULL AND ordered_by IS NOT NULL)
 OR status='CANCELLED'
);

CREATE TABLE lab_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 order_id uuid NOT NULL,
 patient_id uuid NOT NULL,
 report_number text NOT NULL CHECK(report_number ~ '^LAB-[0-9]{4}-[0-9]{6}-R[0-9]+$'),
 report_version integer NOT NULL CHECK(report_version > 0),
 status text NOT NULL DEFAULT 'ISSUED' CHECK(status IN ('ISSUED','SUPERSEDED')),
 snapshot jsonb NOT NULL,
 issued_at timestamptz NOT NULL DEFAULT now(),
 issued_by uuid NOT NULL,
 supersedes_id uuid,
 successor_id uuid,
 is_current boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL, updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,report_number),
 UNIQUE(organization_id,order_id,report_version),
 FOREIGN KEY(organization_id,order_id) REFERENCES lab_orders(organization_id,id),
 FOREIGN KEY(organization_id,patient_id) REFERENCES patients(organization_id,id),
 FOREIGN KEY(organization_id,issued_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,supersedes_id) REFERENCES lab_reports(organization_id,id),
 FOREIGN KEY(organization_id,successor_id) REFERENCES lab_reports(organization_id,id),
 CONSTRAINT lab_reports_current_status CHECK(
  (status='ISSUED' AND is_current=true) OR (status='SUPERSEDED' AND is_current=false)
 ),
 CONSTRAINT lab_reports_predecessor CHECK(
  (report_version=1 AND supersedes_id IS NULL)
  OR (report_version>1 AND supersedes_id IS NOT NULL)
 )
);
CREATE UNIQUE INDEX lab_reports_current ON lab_reports(organization_id,order_id) WHERE is_current;
CREATE INDEX lab_reports_order ON lab_reports(organization_id,order_id,report_version);
CREATE INDEX lab_reports_patient ON lab_reports(organization_id,patient_id,issued_at DESC);
CREATE INDEX lab_reports_issued ON lab_reports(organization_id,issued_at DESC,id);
CREATE TRIGGER lab_reports_updated BEFORE UPDATE ON lab_reports
 FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE FUNCTION protect_lab_report_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
 OR NEW.report_number IS DISTINCT FROM OLD.report_number
 OR NEW.report_version IS DISTINCT FROM OLD.report_version
 OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
 OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
 OR NEW.issued_by IS DISTINCT FROM OLD.issued_by
 OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR NEW.created_by IS DISTINCT FROM OLD.created_by
 OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
 THEN RAISE EXCEPTION 'Laboratory report identity is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER lab_reports_identity BEFORE UPDATE ON lab_reports
 FOR EACH ROW EXECUTE FUNCTION protect_lab_report_identity();
CREATE TRIGGER lab_reports_no_delete BEFORE DELETE ON lab_reports
 FOR EACH ROW EXECUTE FUNCTION forbid_lab_order_delete();

CREATE TABLE lab_report_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 report_id uuid NOT NULL,
 method text NOT NULL CHECK(method IN ('DOWNLOAD','PRINT','MANUAL')),
 recipient_descriptor text NOT NULL DEFAULT '' CHECK(length(recipient_descriptor) <= 160),
 notes text NOT NULL DEFAULT '' CHECK(length(notes) <= 500),
 status text NOT NULL DEFAULT 'RECORDED' CHECK(status IN ('RECORDED','FAILED')),
 failure_reason text NOT NULL DEFAULT '' CHECK(length(failure_reason) <= 500),
 delivered_at timestamptz NOT NULL DEFAULT now(),
 delivered_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,report_id) REFERENCES lab_reports(organization_id,id),
 FOREIGN KEY(organization_id,delivered_by) REFERENCES users(organization_id,id),
 CONSTRAINT lab_report_deliveries_failure CHECK(
  (status='RECORDED' AND failure_reason='')
  OR (status='FAILED' AND failure_reason <> '')
 )
);
CREATE INDEX lab_report_deliveries_report ON lab_report_deliveries(organization_id,report_id,delivered_at);
CREATE FUNCTION forbid_lab_report_delivery_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Laboratory report deliveries are append-only'; END;
$$;
CREATE TRIGGER lab_report_deliveries_immutable BEFORE UPDATE OR DELETE ON lab_report_deliveries
 FOR EACH ROW EXECUTE FUNCTION forbid_lab_report_delivery_mutation();
CREATE INDEX audit_lab_reports ON audit_events(organization_id,entity_type,entity_id,occurred_at DESC);
