-- Laboratory invoicing and append-only payments. Phases 1–7 clinical/report/share semantics are unchanged.
ALTER TABLE organizations ADD COLUMN currency char(3) NOT NULL DEFAULT 'ALL';
ALTER TABLE organizations ADD CONSTRAINT organizations_currency CHECK(currency ~ '^[A-Z]{3}$');
ALTER TABLE organizations ADD COLUMN default_tax_rate numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD CONSTRAINT organizations_tax_rate CHECK(
 default_tax_rate >= 0 AND default_tax_rate <= 100
);

CREATE TABLE lab_invoice_counters (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 year integer NOT NULL CHECK(year BETWEEN 2000 AND 2100),
 last_number bigint NOT NULL CHECK(last_number > 0),
 PRIMARY KEY(organization_id, year)
);

CREATE TABLE lab_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 order_id uuid NOT NULL,
 patient_id uuid NOT NULL,
 invoice_number text NOT NULL DEFAULT '' CHECK(
  invoice_number='' OR invoice_number ~ '^INV-[0-9]{4}-[0-9]{6}$'
 ),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN
  ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','CANCELLED')),
 currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 discount_type text NOT NULL DEFAULT 'NONE' CHECK(discount_type IN ('NONE','PERCENT','FIXED')),
 discount_value numeric(12,2) NOT NULL DEFAULT 0 CHECK(discount_value >= 0),
 tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK(tax_rate >= 0 AND tax_rate <= 100),
 notes text NOT NULL DEFAULT '' CHECK(length(notes) <= 2000),
 subtotal numeric(12,2) NOT NULL CHECK(subtotal >= 0),
 discount_total numeric(12,2) NOT NULL CHECK(discount_total >= 0),
 tax_total numeric(12,2) NOT NULL CHECK(tax_total >= 0),
 total numeric(12,2) NOT NULL CHECK(total >= 0),
 amount_paid numeric(12,2) NOT NULL DEFAULT 0 CHECK(amount_paid >= 0),
 balance_due numeric(12,2) NOT NULL CHECK(balance_due >= 0),
 snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
 issued_at timestamptz,
 issued_by uuid,
 cancelled_at timestamptz,
 cancelled_by uuid,
 cancellation_reason text NOT NULL DEFAULT '' CHECK(length(cancellation_reason) <= 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL,
 updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,order_id) REFERENCES lab_orders(organization_id,id),
 FOREIGN KEY(organization_id,patient_id) REFERENCES patients(organization_id,id),
 FOREIGN KEY(organization_id,issued_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,cancelled_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id),
 CONSTRAINT lab_invoices_totals CHECK(amount_paid + balance_due = total),
 CONSTRAINT lab_invoices_discount CHECK(
  (discount_type='NONE' AND discount_value=0)
  OR (discount_type='PERCENT' AND discount_value <= 100)
  OR discount_type='FIXED'
 ),
 CONSTRAINT lab_invoices_number CHECK(
  (status='DRAFT' AND invoice_number='' AND issued_at IS NULL AND issued_by IS NULL)
  OR (status IN ('ISSUED','PARTIALLY_PAID','PAID') AND invoice_number <> ''
   AND issued_at IS NOT NULL AND issued_by IS NOT NULL)
  OR (status='CANCELLED' AND (
   (invoice_number='' AND issued_at IS NULL AND issued_by IS NULL)
   OR (invoice_number <> '' AND issued_at IS NOT NULL AND issued_by IS NOT NULL)
  ))
 ),
 CONSTRAINT lab_invoices_payment_status CHECK(
  (status IN ('DRAFT','CANCELLED') AND amount_paid=0)
  OR (status='ISSUED' AND amount_paid=0 AND total > 0)
  OR (status='PARTIALLY_PAID' AND amount_paid > 0 AND amount_paid < total)
  OR (status='PAID' AND amount_paid=total)
 ),
 CONSTRAINT lab_invoices_cancelled CHECK(
  (status='CANCELLED' AND cancellation_reason <> '' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
  OR (status<>'CANCELLED' AND cancellation_reason='' AND cancelled_at IS NULL AND cancelled_by IS NULL)
 )
);
CREATE UNIQUE INDEX lab_invoices_number_unique ON lab_invoices(organization_id,invoice_number)
 WHERE invoice_number <> '';
CREATE UNIQUE INDEX lab_invoices_order_active ON lab_invoices(organization_id,order_id)
 WHERE status <> 'CANCELLED';
CREATE INDEX lab_invoices_issued ON lab_invoices(organization_id,issued_at DESC,id);
CREATE INDEX lab_invoices_patient ON lab_invoices(organization_id,patient_id,created_at DESC);
CREATE INDEX lab_invoices_status ON lab_invoices(organization_id,status,created_at DESC);
CREATE TRIGGER lab_invoices_updated BEFORE UPDATE ON lab_invoices
 FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE FUNCTION protect_lab_invoice_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
 OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by
 THEN RAISE EXCEPTION 'Laboratory invoice identity is immutable'; END IF;
 IF OLD.status <> 'DRAFT' THEN
  IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
  OR NEW.currency IS DISTINCT FROM OLD.currency
  OR NEW.discount_type IS DISTINCT FROM OLD.discount_type
  OR NEW.discount_value IS DISTINCT FROM OLD.discount_value
  OR NEW.tax_rate IS DISTINCT FROM OLD.tax_rate
  OR NEW.notes IS DISTINCT FROM OLD.notes
  OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
  OR NEW.discount_total IS DISTINCT FROM OLD.discount_total
  OR NEW.tax_total IS DISTINCT FROM OLD.tax_total
  OR NEW.total IS DISTINCT FROM OLD.total
  OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
  OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
  OR NEW.issued_by IS DISTINCT FROM OLD.issued_by
  THEN RAISE EXCEPTION 'Issued invoice financial content is immutable'; END IF;
 END IF;
 IF OLD.cancelled_at IS NOT NULL AND (
  NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
  OR NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason OR NEW.status <> 'CANCELLED'
 ) THEN RAISE EXCEPTION 'Invoice cancellation is immutable'; END IF;
 IF OLD.status='CANCELLED' AND NEW.status IS DISTINCT FROM OLD.status
 THEN RAISE EXCEPTION 'Cancelled invoices cannot change status'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER lab_invoices_identity BEFORE UPDATE ON lab_invoices
 FOR EACH ROW EXECUTE FUNCTION protect_lab_invoice_identity();
CREATE TRIGGER lab_invoices_no_delete BEFORE DELETE ON lab_invoices
 FOR EACH ROW EXECUTE FUNCTION forbid_lab_order_delete();

CREATE TABLE lab_invoice_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 invoice_id uuid NOT NULL,
 amount numeric(12,2) NOT NULL CHECK(amount > 0),
 currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 method text NOT NULL CHECK(method IN ('CASH','CARD','BANK_TRANSFER','OTHER')),
 reference text NOT NULL DEFAULT '' CHECK(length(reference) <= 120),
 notes text NOT NULL DEFAULT '' CHECK(length(notes) <= 500),
 received_at timestamptz NOT NULL DEFAULT now(),
 recorded_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,invoice_id) REFERENCES lab_invoices(organization_id,id),
 FOREIGN KEY(organization_id,recorded_by) REFERENCES users(organization_id,id)
);
CREATE INDEX lab_invoice_payments_invoice ON lab_invoice_payments(organization_id,invoice_id,received_at,id);
CREATE FUNCTION forbid_lab_invoice_payment_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Laboratory invoice payments are append-only'; END;
$$;
CREATE TRIGGER lab_invoice_payments_immutable BEFORE UPDATE OR DELETE ON lab_invoice_payments
 FOR EACH ROW EXECUTE FUNCTION forbid_lab_invoice_payment_mutation();
CREATE INDEX audit_lab_invoices ON audit_events(organization_id,entity_type,entity_id,occurred_at DESC);
