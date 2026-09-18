-- Organization-scoped prescription templates. Copied medications become independent
-- prescription items; later template edits or deletion cannot change issued drafts.
-- Phases 1–10 laboratory, billing and clinical prescription semantics are unchanged.

CREATE TABLE prescription_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
 description text NOT NULL DEFAULT '' CHECK(length(description) <= 2000),
 category text NOT NULL DEFAULT '' CHECK(length(category) <= 120),
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL,
 updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id)
);
CREATE UNIQUE INDEX prescription_templates_name
 ON prescription_templates(organization_id,lower(btrim(name)));
CREATE INDEX prescription_templates_status
 ON prescription_templates(organization_id,is_active,lower(name),id);
CREATE INDEX prescription_templates_category
 ON prescription_templates(organization_id,lower(category),lower(name),id)
 WHERE category <> '';
CREATE TRIGGER prescription_templates_updated BEFORE UPDATE ON prescription_templates
 FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE FUNCTION protect_prescription_template_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
  RAISE EXCEPTION 'Prescription template identity is immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER prescription_templates_identity BEFORE UPDATE ON prescription_templates
 FOR EACH ROW EXECUTE FUNCTION protect_prescription_template_identity();

CREATE TABLE prescription_template_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 template_id uuid NOT NULL,
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
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,template_id,sort_order),
 FOREIGN KEY(organization_id,template_id) REFERENCES prescription_templates(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX prescription_template_items_template
 ON prescription_template_items(organization_id,template_id,sort_order);

ALTER TABLE clinical_prescriptions ADD COLUMN source_template_id uuid;
ALTER TABLE clinical_prescriptions ADD CONSTRAINT clinical_prescriptions_source_template
 FOREIGN KEY(organization_id,source_template_id)
 REFERENCES prescription_templates(organization_id,id)
 ON DELETE SET NULL (source_template_id);
CREATE INDEX clinical_prescriptions_source_template
 ON clinical_prescriptions(organization_id,source_template_id)
 WHERE source_template_id IS NOT NULL;

CREATE INDEX audit_prescription_templates
 ON audit_events(organization_id,entity_type,entity_id,occurred_at DESC);
