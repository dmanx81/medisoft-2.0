-- Secure, expiring, revocable patient/recipient links to issued laboratory reports.
-- Phase 6 report snapshots, versioning and PDF rendering are unchanged.
CREATE TABLE lab_report_shares (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 report_id uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 revoked_by uuid,
 recipient_name text NOT NULL DEFAULT '' CHECK(length(recipient_name) <= 160),
 recipient_email text NOT NULL DEFAULT '' CHECK(length(recipient_email) <= 254),
 purpose text NOT NULL DEFAULT '' CHECK(length(purpose) <= 200),
 token_digest text NOT NULL CHECK(length(token_digest)=64),
 pin_hash text NOT NULL,
 access_count integer NOT NULL DEFAULT 0 CHECK(access_count >= 0),
 last_accessed_at timestamptz,
 UNIQUE(organization_id,id),
 UNIQUE(token_digest),
 FOREIGN KEY(organization_id,report_id) REFERENCES lab_reports(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,revoked_by) REFERENCES users(organization_id,id),
 CONSTRAINT lab_report_shares_revoke CHECK(
  (revoked_at IS NULL AND revoked_by IS NULL)
  OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
 )
);
CREATE INDEX lab_report_shares_report ON lab_report_shares(organization_id,report_id,created_at DESC);
CREATE INDEX lab_report_shares_expiry ON lab_report_shares(expires_at);
CREATE FUNCTION protect_lab_report_share_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.report_id IS DISTINCT FROM OLD.report_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
 OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.token_digest IS DISTINCT FROM OLD.token_digest
 OR NEW.pin_hash IS DISTINCT FROM OLD.pin_hash
 OR NEW.recipient_name IS DISTINCT FROM OLD.recipient_name
 OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email
 OR NEW.purpose IS DISTINCT FROM OLD.purpose
 THEN RAISE EXCEPTION 'Laboratory report share identity is immutable'; END IF;
 IF OLD.revoked_at IS NOT NULL AND (
  NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by
 ) THEN RAISE EXCEPTION 'Laboratory report share revocation is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER lab_report_shares_identity BEFORE UPDATE ON lab_report_shares
 FOR EACH ROW EXECUTE FUNCTION protect_lab_report_share_identity();
CREATE TRIGGER lab_report_shares_no_delete BEFORE DELETE ON lab_report_shares
 FOR EACH ROW EXECUTE FUNCTION forbid_lab_order_delete();

CREATE TABLE lab_report_share_sessions (
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64),
 organization_id uuid NOT NULL,
 share_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 FOREIGN KEY(organization_id,share_id) REFERENCES lab_report_shares(organization_id,id)
);
CREATE INDEX lab_report_share_sessions_share ON lab_report_share_sessions(organization_id,share_id);
CREATE INDEX lab_report_share_sessions_expiry ON lab_report_share_sessions(expires_at);

CREATE TABLE share_access_limits (
 account_hash text PRIMARY KEY,
 attempts integer NOT NULL DEFAULT 1,
 window_start timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_lab_report_shares ON audit_events(organization_id,entity_type,entity_id,occurred_at DESC);
