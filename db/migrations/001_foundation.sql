CREATE TABLE organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 type text NOT NULL CHECK(type IN ('LABORATORY','CLINIC','DIAGNOSTIC_CENTER')),
 logo text, address text, phone text, email text, country char(2) NOT NULL,
 timezone text NOT NULL DEFAULT 'Europe/Tirane', default_language text NOT NULL DEFAULT 'sq' CHECK(default_language IN ('en','sq')),
 ai_enabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL, email text NOT NULL UNIQUE CHECK(email=lower(email)), password_hash text NOT NULL,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED','INVITED')),
 role text NOT NULL CHECK(role IN ('PLATFORM_ADMIN','ORG_ADMIN','RECEPTIONIST','LAB_TECHNICIAN','BIOCHEMIST','DOCTOR','VIEWER')),
 last_login_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id)
);
CREATE INDEX users_organization ON users(organization_id);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64), organization_id uuid NOT NULL,
 user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id)
);
CREATE INDEX sessions_user ON sessions(organization_id,user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_limits (
 account_hash text PRIMARY KEY, attempts integer NOT NULL DEFAULT 1,
 window_start timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 user_id uuid, action text NOT NULL, entity_type text NOT NULL, entity_id text,
 occurred_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}',
 session_hash text, ip_address inet,
 FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id)
);
CREATE INDEX audit_organization_time ON audit_events(organization_id,occurred_at DESC);
CREATE FUNCTION forbid_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'Audit events are append-only'; END;
$$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_mutation();
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN NEW.updated_at=now(); RETURN NEW; END;
$$;
CREATE TRIGGER organizations_updated BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
