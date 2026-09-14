-- Laboratory billing operations: payment reversals, credit notes, due dates and
-- invoice email delivery. Phases 1–8 clinical/report/share/invoice-snapshot
-- semantics are unchanged. Migrations 001–008 are not modified.

ALTER TABLE lab_invoices ADD COLUMN due_date date;
ALTER TABLE lab_invoices ADD COLUMN credit_total numeric(12,2) NOT NULL DEFAULT 0
 CHECK(credit_total >= 0);

ALTER TABLE lab_invoices DROP CONSTRAINT lab_invoices_totals;
ALTER TABLE lab_invoices DROP CONSTRAINT lab_invoices_payment_status;
ALTER TABLE lab_invoices ADD CONSTRAINT lab_invoices_totals CHECK(
 amount_paid + credit_total + balance_due = total
);
ALTER TABLE lab_invoices ADD CONSTRAINT lab_invoices_payment_status CHECK(
  (status IN ('DRAFT','CANCELLED') AND amount_paid=0 AND credit_total=0)
  OR (status='ISSUED' AND amount_paid=0 AND credit_total=0 AND total > 0 AND balance_due=total)
  OR (status='PARTIALLY_PAID' AND balance_due > 0 AND (amount_paid > 0 OR credit_total > 0))
  OR (status='PAID' AND balance_due=0 AND amount_paid + credit_total = total)
);

CREATE OR REPLACE FUNCTION protect_lab_invoice_identity() RETURNS trigger LANGUAGE plpgsql AS $$
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
  OR NEW.due_date IS DISTINCT FROM OLD.due_date
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

CREATE TABLE lab_invoice_payment_reversals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 payment_id uuid NOT NULL,
 invoice_id uuid NOT NULL,
 amount numeric(12,2) NOT NULL CHECK(amount > 0),
 currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 recorded_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,payment_id) REFERENCES lab_invoice_payments(organization_id,id),
 FOREIGN KEY(organization_id,invoice_id) REFERENCES lab_invoices(organization_id,id),
 FOREIGN KEY(organization_id,recorded_by) REFERENCES users(organization_id,id)
);
CREATE INDEX lab_invoice_payment_reversals_payment
 ON lab_invoice_payment_reversals(organization_id,payment_id,created_at,id);
CREATE INDEX lab_invoice_payment_reversals_invoice
 ON lab_invoice_payment_reversals(organization_id,invoice_id,created_at,id);
CREATE FUNCTION forbid_lab_invoice_payment_reversal_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Laboratory invoice payment reversals are append-only'; END;
$$;
CREATE TRIGGER lab_invoice_payment_reversals_immutable
 BEFORE UPDATE OR DELETE ON lab_invoice_payment_reversals
 FOR EACH ROW EXECUTE FUNCTION forbid_lab_invoice_payment_reversal_mutation();

CREATE TABLE lab_credit_note_counters (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 year integer NOT NULL CHECK(year BETWEEN 2000 AND 2100),
 last_number bigint NOT NULL CHECK(last_number > 0),
 PRIMARY KEY(organization_id, year)
);

CREATE TABLE lab_credit_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 invoice_id uuid NOT NULL,
 credit_note_number text NOT NULL DEFAULT '' CHECK(
  credit_note_number='' OR credit_note_number ~ '^CN-[0-9]{4}-[0-9]{6}$'
 ),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ISSUED')),
 currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 notes text NOT NULL DEFAULT '' CHECK(length(notes) <= 2000),
 subtotal numeric(12,2) NOT NULL CHECK(subtotal >= 0),
 tax_total numeric(12,2) NOT NULL CHECK(tax_total >= 0),
 total numeric(12,2) NOT NULL CHECK(total > 0),
 snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
 issued_at timestamptz,
 issued_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL,
 updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,invoice_id) REFERENCES lab_invoices(organization_id,id),
 FOREIGN KEY(organization_id,issued_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id),
 CONSTRAINT lab_credit_notes_number CHECK(
  (status='DRAFT' AND credit_note_number='' AND issued_at IS NULL AND issued_by IS NULL)
  OR (status='ISSUED' AND credit_note_number <> '' AND issued_at IS NOT NULL AND issued_by IS NOT NULL)
 ),
 CONSTRAINT lab_credit_notes_totals CHECK(subtotal + tax_total = total)
);
CREATE UNIQUE INDEX lab_credit_notes_number_unique
 ON lab_credit_notes(organization_id,credit_note_number)
 WHERE credit_note_number <> '';
CREATE INDEX lab_credit_notes_invoice
 ON lab_credit_notes(organization_id,invoice_id,created_at DESC,id);
CREATE TRIGGER lab_credit_notes_updated BEFORE UPDATE ON lab_credit_notes
 FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE FUNCTION protect_lab_credit_note_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
 OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR NEW.created_by IS DISTINCT FROM OLD.created_by
 THEN RAISE EXCEPTION 'Laboratory credit note identity is immutable'; END IF;
 IF OLD.status <> 'DRAFT' THEN
  IF NEW.credit_note_number IS DISTINCT FROM OLD.credit_note_number
  OR NEW.status IS DISTINCT FROM OLD.status
  OR NEW.currency IS DISTINCT FROM OLD.currency
  OR NEW.reason IS DISTINCT FROM OLD.reason
  OR NEW.notes IS DISTINCT FROM OLD.notes
  OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
  OR NEW.tax_total IS DISTINCT FROM OLD.tax_total
  OR NEW.total IS DISTINCT FROM OLD.total
  OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
  OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
  OR NEW.issued_by IS DISTINCT FROM OLD.issued_by
  THEN RAISE EXCEPTION 'Issued credit note content is immutable'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER lab_credit_notes_identity BEFORE UPDATE ON lab_credit_notes
 FOR EACH ROW EXECUTE FUNCTION protect_lab_credit_note_identity();
CREATE TRIGGER lab_credit_notes_no_delete BEFORE DELETE ON lab_credit_notes
 FOR EACH ROW EXECUTE FUNCTION forbid_lab_order_delete();

CREATE TABLE lab_invoice_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 invoice_id uuid NOT NULL,
 method text NOT NULL CHECK(method='EMAIL'),
 recipient text NOT NULL CHECK(length(recipient) BETWEEN 3 AND 254),
 recorded_by uuid NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,invoice_id) REFERENCES lab_invoices(organization_id,id),
 FOREIGN KEY(organization_id,recorded_by) REFERENCES users(organization_id,id)
);
CREATE INDEX lab_invoice_deliveries_invoice
 ON lab_invoice_deliveries(organization_id,invoice_id,occurred_at,id);
CREATE FUNCTION forbid_lab_invoice_delivery_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Laboratory invoice deliveries are append-only'; END;
$$;
CREATE TRIGGER lab_invoice_deliveries_immutable
 BEFORE UPDATE OR DELETE ON lab_invoice_deliveries
 FOR EACH ROW EXECUTE FUNCTION forbid_lab_invoice_delivery_mutation();
CREATE INDEX audit_lab_credit_notes ON audit_events(organization_id,entity_type,entity_id,occurred_at DESC);
