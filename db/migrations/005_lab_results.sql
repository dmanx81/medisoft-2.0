-- Laboratory results, interpretation snapshots, validation and amendments.
-- Phase 4 order statuses gain IN_PROCESS once result entry begins.
ALTER TABLE lab_orders DROP CONSTRAINT lab_orders_status_check;
ALTER TABLE lab_orders ADD CONSTRAINT lab_orders_status_check CHECK(status IN
 ('DRAFT','ORDERED','PARTIALLY_COLLECTED','COLLECTED','RECEIVED','IN_PROCESS','CANCELLED'));
ALTER TABLE lab_orders DROP CONSTRAINT lab_orders_placed;
ALTER TABLE lab_orders ADD CONSTRAINT lab_orders_placed CHECK(
 (status='DRAFT' AND ordered_at IS NULL AND ordered_by IS NULL)
 OR (status IN ('ORDERED','PARTIALLY_COLLECTED','COLLECTED','RECEIVED','IN_PROCESS')
     AND ordered_at IS NOT NULL AND ordered_by IS NOT NULL)
 OR status='CANCELLED'
);

CREATE TABLE lab_results (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 order_id uuid NOT NULL,
 order_test_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'ENTERED' CHECK(status IN
  ('ENTERED','TECHNICALLY_VALIDATED','CLINICALLY_VERIFIED','SUPERSEDED')),
 result_type_snapshot text NOT NULL CHECK(result_type_snapshot IN
  ('NUMERIC','TEXT','BOOLEAN','CATEGORICAL')),
 numeric_value numeric,
 text_value text NOT NULL DEFAULT '' CHECK(length(text_value) <= 500),
 boolean_value boolean,
 unit_symbol_snapshot text NOT NULL DEFAULT '' CHECK(length(unit_symbol_snapshot) <= 32),
 method_snapshot text NOT NULL DEFAULT '' CHECK(length(method_snapshot) <= 120),
 flag text NOT NULL DEFAULT 'UNINTERPRETED' CHECK(flag IN
  ('UNINTERPRETED','NORMAL','LOW','HIGH','CRITICAL_LOW','CRITICAL_HIGH')),
 reference_range_id uuid,
 range_version_snapshot integer CHECK(range_version_snapshot IS NULL OR range_version_snapshot > 0),
 range_sex_snapshot text NOT NULL DEFAULT '' CHECK(length(range_sex_snapshot) <= 16),
 range_lower_snapshot numeric,
 range_upper_snapshot numeric,
 range_lower_operator_snapshot text NOT NULL DEFAULT '' CHECK(length(range_lower_operator_snapshot) <= 8),
 range_upper_operator_snapshot text NOT NULL DEFAULT '' CHECK(length(range_upper_operator_snapshot) <= 8),
 range_text_snapshot text NOT NULL DEFAULT '' CHECK(length(range_text_snapshot) <= 240),
 range_unit_symbol_snapshot text NOT NULL DEFAULT '' CHECK(length(range_unit_symbol_snapshot) <= 32),
 range_method_snapshot text NOT NULL DEFAULT '' CHECK(length(range_method_snapshot) <= 120),
 critical_low_snapshot numeric,
 critical_high_snapshot numeric,
 entered_at timestamptz NOT NULL DEFAULT now(),
 entered_by uuid NOT NULL,
 technically_validated_at timestamptz,
 technically_validated_by uuid,
 clinically_verified_at timestamptz,
 clinically_verified_by uuid,
 amendment_reason text NOT NULL DEFAULT '' CHECK(length(amendment_reason) <= 500),
 supersedes_id uuid,
 successor_id uuid,
 is_current boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL, updated_by uuid NOT NULL,
 UNIQUE(organization_id,id), UNIQUE(organization_id,order_id,id),
 FOREIGN KEY(organization_id,order_id) REFERENCES lab_orders(organization_id,id),
 FOREIGN KEY(organization_id,order_id,order_test_id)
  REFERENCES lab_order_tests(organization_id,order_id,id),
 FOREIGN KEY(organization_id,reference_range_id)
  REFERENCES lab_reference_ranges(organization_id,id),
 FOREIGN KEY(organization_id,entered_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,technically_validated_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,clinically_verified_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,supersedes_id) REFERENCES lab_results(organization_id,id),
 FOREIGN KEY(organization_id,successor_id) REFERENCES lab_results(organization_id,id),
 CONSTRAINT lab_results_value CHECK(
  (result_type_snapshot='NUMERIC' AND numeric_value IS NOT NULL AND boolean_value IS NULL)
  OR (result_type_snapshot IN ('TEXT','CATEGORICAL') AND text_value <> '' AND numeric_value IS NULL AND boolean_value IS NULL)
  OR (result_type_snapshot='BOOLEAN' AND boolean_value IS NOT NULL AND numeric_value IS NULL)
 ),
 CONSTRAINT lab_results_lifecycle CHECK(
  (status='ENTERED' AND technically_validated_at IS NULL AND technically_validated_by IS NULL
   AND clinically_verified_at IS NULL AND clinically_verified_by IS NULL)
  OR (status='TECHNICALLY_VALIDATED' AND technically_validated_at IS NOT NULL
   AND technically_validated_by IS NOT NULL AND clinically_verified_at IS NULL
   AND clinically_verified_by IS NULL)
  OR (status IN ('CLINICALLY_VERIFIED','SUPERSEDED') AND technically_validated_at IS NOT NULL
   AND technically_validated_by IS NOT NULL AND clinically_verified_at IS NOT NULL
   AND clinically_verified_by IS NOT NULL)
 ),
 CONSTRAINT lab_results_amendment CHECK(
  (supersedes_id IS NULL AND amendment_reason = '')
  OR (supersedes_id IS NOT NULL AND amendment_reason <> '')
 ),
 CONSTRAINT lab_results_current_status CHECK(is_current=false OR status<>'SUPERSEDED')
);
CREATE UNIQUE INDEX lab_results_current ON lab_results(organization_id,order_test_id) WHERE is_current;
CREATE INDEX lab_results_order ON lab_results(organization_id,order_id,created_at);
CREATE INDEX lab_results_order_test ON lab_results(organization_id,order_test_id,created_at);
CREATE INDEX lab_results_status ON lab_results(organization_id,status);
CREATE TRIGGER lab_results_updated BEFORE UPDATE ON lab_results
 FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE FUNCTION protect_lab_result_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.order_test_id IS DISTINCT FROM OLD.order_test_id
 OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by
 OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
 THEN RAISE EXCEPTION 'Laboratory result identity is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER lab_results_identity BEFORE UPDATE ON lab_results
 FOR EACH ROW EXECUTE FUNCTION protect_lab_result_identity();
CREATE FUNCTION protect_lab_result_clinical() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status <> 'ENTERED' AND (
  NEW.result_type_snapshot IS DISTINCT FROM OLD.result_type_snapshot
  OR NEW.numeric_value IS DISTINCT FROM OLD.numeric_value
  OR NEW.text_value IS DISTINCT FROM OLD.text_value
  OR NEW.boolean_value IS DISTINCT FROM OLD.boolean_value
  OR NEW.unit_symbol_snapshot IS DISTINCT FROM OLD.unit_symbol_snapshot
  OR NEW.method_snapshot IS DISTINCT FROM OLD.method_snapshot
  OR NEW.flag IS DISTINCT FROM OLD.flag
  OR NEW.reference_range_id IS DISTINCT FROM OLD.reference_range_id
  OR NEW.range_version_snapshot IS DISTINCT FROM OLD.range_version_snapshot
  OR NEW.range_sex_snapshot IS DISTINCT FROM OLD.range_sex_snapshot
  OR NEW.range_lower_snapshot IS DISTINCT FROM OLD.range_lower_snapshot
  OR NEW.range_upper_snapshot IS DISTINCT FROM OLD.range_upper_snapshot
  OR NEW.range_lower_operator_snapshot IS DISTINCT FROM OLD.range_lower_operator_snapshot
  OR NEW.range_upper_operator_snapshot IS DISTINCT FROM OLD.range_upper_operator_snapshot
  OR NEW.range_text_snapshot IS DISTINCT FROM OLD.range_text_snapshot
  OR NEW.range_unit_symbol_snapshot IS DISTINCT FROM OLD.range_unit_symbol_snapshot
  OR NEW.range_method_snapshot IS DISTINCT FROM OLD.range_method_snapshot
  OR NEW.critical_low_snapshot IS DISTINCT FROM OLD.critical_low_snapshot
  OR NEW.critical_high_snapshot IS DISTINCT FROM OLD.critical_high_snapshot
  OR NEW.entered_at IS DISTINCT FROM OLD.entered_at
  OR NEW.entered_by IS DISTINCT FROM OLD.entered_by
  OR NEW.amendment_reason IS DISTINCT FROM OLD.amendment_reason
 ) THEN RAISE EXCEPTION 'Finalized laboratory results are immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER lab_results_clinical BEFORE UPDATE ON lab_results
 FOR EACH ROW EXECUTE FUNCTION protect_lab_result_clinical();
CREATE TRIGGER lab_results_no_delete BEFORE DELETE ON lab_results
 FOR EACH ROW EXECUTE FUNCTION forbid_lab_order_delete();
CREATE INDEX audit_lab_results ON audit_events(organization_id,entity_type,entity_id,occurred_at DESC);
