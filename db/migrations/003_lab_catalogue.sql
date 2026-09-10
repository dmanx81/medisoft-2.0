-- Laboratory test catalogue and versioned reference ranges.
-- Changing a password immediately ends that user's sessions.
CREATE FUNCTION revoke_sessions_on_password_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
  DELETE FROM sessions WHERE organization_id=NEW.organization_id AND user_id=NEW.id;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER users_password_revokes_sessions
 AFTER UPDATE OF password_hash ON users
 FOR EACH ROW EXECUTE FUNCTION revoke_sessions_on_password_change();

CREATE TABLE lab_test_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 code text NOT NULL CHECK(code=upper(code) AND code ~ '^[A-Z][A-Z0-9_]{0,31}$'),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80),
 display_order integer NOT NULL DEFAULT 0 CHECK(display_order BETWEEN 0 AND 1000000),
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,code)
);
CREATE INDEX lab_test_categories_org ON lab_test_categories(organization_id,display_order,name);
CREATE TRIGGER lab_test_categories_updated BEFORE UPDATE ON lab_test_categories
 FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE lab_units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 code text NOT NULL CHECK(code=upper(code) AND code ~ '^[A-Z0-9][A-Z0-9_]{0,31}$'),
 symbol text NOT NULL CHECK(length(btrim(symbol)) BETWEEN 1 AND 32),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,code)
);
CREATE INDEX lab_units_org ON lab_units(organization_id,symbol);

CREATE TABLE lab_tests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 category_id uuid NOT NULL,
 code text NOT NULL CHECK(code=upper(code) AND code ~ '^[A-Z0-9][A-Z0-9._-]{0,31}$'),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
 short_name text NOT NULL DEFAULT '' CHECK(length(short_name) <= 40),
 description text NOT NULL DEFAULT '' CHECK(length(description) <= 2000),
 specimen_type text NOT NULL CHECK(specimen_type IN
  ('SERUM','PLASMA','WHOLE_BLOOD','URINE','STOOL','SWAB','SPUTUM','OTHER')),
 result_type text NOT NULL CHECK(result_type IN
  ('NUMERIC','TEXT','BOOLEAN','CATEGORICAL')),
 unit_id uuid,
 method text NOT NULL DEFAULT '' CHECK(length(method) <= 120),
 display_order integer NOT NULL DEFAULT 0 CHECK(display_order BETWEEN 0 AND 1000000),
 base_price numeric(12,2) CHECK(base_price IS NULL OR base_price >= 0),
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL, updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(organization_id,id), UNIQUE(organization_id,code),
 FOREIGN KEY(organization_id,category_id) REFERENCES lab_test_categories(organization_id,id),
 FOREIGN KEY(organization_id,unit_id) REFERENCES lab_units(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id),
 CONSTRAINT lab_tests_numeric_unit CHECK(result_type<>'NUMERIC' OR unit_id IS NOT NULL)
);
CREATE INDEX lab_tests_name ON lab_tests(organization_id,lower(name),id);
CREATE INDEX lab_tests_code ON lab_tests(organization_id,code);
CREATE INDEX lab_tests_category ON lab_tests(organization_id,category_id);
CREATE INDEX lab_tests_status ON lab_tests(organization_id,is_active);
CREATE INDEX lab_tests_updated ON lab_tests(organization_id,updated_at DESC,id);
CREATE TRIGGER lab_tests_updated BEFORE UPDATE ON lab_tests
 FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE FUNCTION protect_lab_test_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by
 THEN RAISE EXCEPTION 'Laboratory test identity is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER lab_tests_identity BEFORE UPDATE ON lab_tests
 FOR EACH ROW EXECUTE FUNCTION protect_lab_test_identity();

-- Clinical bounds are immutable. Retirement/replacement only close the validity window.
CREATE TABLE lab_reference_ranges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 test_id uuid NOT NULL,
 sex text NOT NULL DEFAULT 'ANY' CHECK(sex IN ('ANY','MALE','FEMALE')),
 age_min numeric(8,2) CHECK(age_min IS NULL OR age_min >= 0),
 age_max numeric(8,2) CHECK(age_max IS NULL OR age_max >= 0),
 age_unit text NOT NULL DEFAULT 'YEARS' CHECK(age_unit IN ('YEARS','MONTHS','DAYS')),
 lower_bound numeric, upper_bound numeric,
 lower_operator text NOT NULL DEFAULT 'GE' CHECK(lower_operator IN ('GT','GE')),
 upper_operator text NOT NULL DEFAULT 'LE' CHECK(upper_operator IN ('LT','LE')),
 text_range text NOT NULL DEFAULT '' CHECK(length(text_range) <= 240),
 unit_id uuid, method text NOT NULL DEFAULT '' CHECK(length(method) <= 120),
 critical_low numeric, critical_high numeric,
 valid_from timestamptz NOT NULL DEFAULT now(), valid_to timestamptz,
 is_active boolean NOT NULL DEFAULT true,
 range_version integer NOT NULL DEFAULT 1 CHECK(range_version>0),
 supersedes_id uuid, successor_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
 retired_at timestamptz, retired_by uuid,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,test_id) REFERENCES lab_tests(organization_id,id),
 FOREIGN KEY(organization_id,unit_id) REFERENCES lab_units(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,retired_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,supersedes_id) REFERENCES lab_reference_ranges(organization_id,id),
 FOREIGN KEY(organization_id,successor_id) REFERENCES lab_reference_ranges(organization_id,id),
 CONSTRAINT lab_range_age CHECK(age_min IS NULL OR age_max IS NULL OR age_min <= age_max),
 CONSTRAINT lab_range_bounds CHECK(lower_bound IS NULL OR upper_bound IS NULL OR lower_bound <= upper_bound),
 CONSTRAINT lab_range_critical CHECK(critical_low IS NULL OR critical_high IS NULL OR critical_low <= critical_high),
 CONSTRAINT lab_range_window CHECK(valid_to IS NULL OR valid_to >= valid_from),
 CONSTRAINT lab_range_open CHECK(is_active=false OR valid_to IS NULL),
 CONSTRAINT lab_range_retired CHECK(
  (is_active=true AND retired_at IS NULL AND retired_by IS NULL AND successor_id IS NULL)
  OR (is_active=false AND retired_at IS NOT NULL AND retired_by IS NOT NULL)
 ),
 CONSTRAINT lab_range_value CHECK(
  lower_bound IS NOT NULL OR upper_bound IS NOT NULL OR length(btrim(text_range))>0
 )
);
CREATE INDEX lab_ranges_test ON lab_reference_ranges(organization_id,test_id,is_active,valid_from DESC);
CREATE INDEX lab_ranges_current ON lab_reference_ranges(organization_id,test_id) WHERE is_active;
CREATE FUNCTION protect_lab_range_clinical() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.test_id IS DISTINCT FROM OLD.test_id OR NEW.sex IS DISTINCT FROM OLD.sex
 OR NEW.age_min IS DISTINCT FROM OLD.age_min OR NEW.age_max IS DISTINCT FROM OLD.age_max
 OR NEW.age_unit IS DISTINCT FROM OLD.age_unit OR NEW.lower_bound IS DISTINCT FROM OLD.lower_bound
 OR NEW.upper_bound IS DISTINCT FROM OLD.upper_bound
 OR NEW.lower_operator IS DISTINCT FROM OLD.lower_operator
 OR NEW.upper_operator IS DISTINCT FROM OLD.upper_operator
 OR NEW.text_range IS DISTINCT FROM OLD.text_range OR NEW.unit_id IS DISTINCT FROM OLD.unit_id
 OR NEW.method IS DISTINCT FROM OLD.method OR NEW.critical_low IS DISTINCT FROM OLD.critical_low
 OR NEW.critical_high IS DISTINCT FROM OLD.critical_high
 OR NEW.range_version IS DISTINCT FROM OLD.range_version
 OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
 OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
 OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by
 THEN RAISE EXCEPTION 'Reference range clinical content is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER lab_ranges_clinical BEFORE UPDATE ON lab_reference_ranges
 FOR EACH ROW EXECUTE FUNCTION protect_lab_range_clinical();
CREATE INDEX audit_lab_catalogue ON audit_events(organization_id,entity_type,entity_id,occurred_at DESC);
