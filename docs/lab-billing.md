# Laboratory billing — Phase 8

Phase 8 adds organization-scoped laboratory invoicing around a single laboratory order, with immutable issued invoices and append-only payment history. Clinical verification, order completion, official reports and secure report sharing from Phases 6–7 are unchanged.

The workflow is: laboratory order → billable active tests → draft invoice → issued invoice → payments → balance → paid.

Payment status never determines whether a clinical result can be verified. An unpaid patient may still have a clinically completed order.

Phase 9 adds payment reversals, credit notes, receipt PDFs, invoice due dates, organization billing settings, and manual invoice email on top of this model. Issued invoice snapshots and original payment rows remain immutable.

## Migration

`008_billing.sql` adds `organizations.currency`, `organizations.default_tax_rate`, `lab_invoice_counters`, `lab_invoices` and append-only `lab_invoice_payments`. `009_billing_operations.sql` adds due dates, credit totals, payment reversals, credit notes and invoice email deliveries. Migrations 001–007 are unchanged.

Money columns use `numeric(12,2)`. Invoice identity (organization, order, patient, creator) is immutable. After an invoice leaves `DRAFT`, billed totals, currency, discount, tax, notes, invoice number, issuer and `snapshot` cannot change. Payments and cancellation do not rewrite billed amounts. Issued invoices and payment rows cannot be deleted.

## Invoice model

One invoice may exist per laboratory order at a time. A cancelled unpaid invoice can be replaced. There is no multi-order consolidated invoicing.

Statuses:

- `DRAFT` — editable financial fields, no invoice number
- `ISSUED` — official document, number allocated, snapshot frozen, unpaid
- `PARTIALLY_PAID` / `PAID` — derived from recorded payments; the browser cannot set these
- `CANCELLED` — unpaid draft or unpaid issued invoice only

Invoice numbers are tenant-scoped and allocated at issuance:

`INV-YYYY-NNNNNN`

Numbers are never reused or renumbered. Sequencing uses `INSERT … ON CONFLICT DO UPDATE` after locking the organization row.

## Billable source

Billable lines come from `lab_order_tests` that are `ACTIVE`. Cancelled ordered tests are excluded. Unit price, code and name are the order-time snapshots (`base_price_snapshot`, `code_snapshot`, `name_snapshot`), not today’s catalogue. A missing price snapshot is billed as `0.00`. Quantity is `1.00` in Phase 8.

An order may be invoiced regardless of clinical completion. Cancelled orders cannot be invoiced.

## Snapshot

Issuance freezes `schema_version: 1` JSON sufficient to render the official invoice without live joins: organization identity/contact/currency already stored on the organization, patient billing identity, order number/date/physician, invoice number/date/issuer/notes/discount/tax, lines and totals.

`invoiceFromSnapshot()` is the only official invoice-document builder. Issued PDFs, list labels and search for issued invoices use that frozen identity. Later patient, catalogue, organization or price changes do not rewrite it.

## Calculations

`calculateInvoiceTotals()` is the only financial calculator. Arithmetic uses integer cents (`bigint`), never floating point. Rounding is half-up to two decimal places.

Invoice-level discount is `NONE`, `PERCENT` or `FIXED` (fixed discounts are capped at subtotal). Tax is a percentage applied to `(subtotal − discount)`. Line-level discounts are stored as `0.00` in Phase 8. The UI displays server-calculated totals.

Default currency is the organization `currency` column (`ALL` unless changed). There is no conversion or multi-currency line support.

## Payments

Staff record manual payments (`CASH`, `CARD`, `BANK_TRANSFER`, `OTHER`). `CARD` means a card payment was taken elsewhere; this system is not a PCI processor and does not store PAN/CVV or banking secrets.

Rules:

- amount > 0
- currency matches the invoice
- invoice must be `ISSUED` or `PARTIALLY_PAID`
- cancelled invoices cannot receive payment
- overpayments are rejected (`PAYMENT_EXCEEDS_BALANCE`)
- successful payments are append-only; UPDATE/DELETE are forbidden
- payment reversals are additional append-only records; original payment rows are never updated

Balance 0 becomes `PAID`. A positive remaining balance after some payment becomes `PARTIALLY_PAID`. Issued billed totals stay unchanged.

## Cancellation

Drafts may be cancelled (they keep an empty invoice number). Issued invoices with zero payments may be cancelled with a reason. `PARTIALLY_PAID` and `PAID` cannot be cancelled in Phase 8.

## PDF

`GET /api/lab-invoices/:id/pdf` renders the issued snapshot with pdfkit (`compress: false`). The official PDF is the billed document, not the current ledger. Payment/balance belong on the invoice screen. Receipt PDFs are deferred; the UI payment list is the Phase 8 receipt.

## Permissions

- `billing:read` — ORG_ADMIN, PLATFORM_ADMIN, RECEPTIONIST, BIOCHEMIST
- `billing:create` / `billing:issue` / `billing:payment-record` — administrators and receptionist
- `billing:email` — administrators and receptionist (manual official-PDF send only)
- `billing:cancel` / `billing:correct` / `billing:settings` — administrators only

Recording a payment does not grant reversal, credit-note, or settings permission. Doctors, laboratory technicians and viewers have no billing permission. Server routes enforce this independently of UI.

## APIs

- `GET /api/lab-orders/:id/invoice-context`
- `POST /api/lab-orders/:id/invoices`
- `POST /api/lab-invoices/search`
- `GET|PATCH /api/lab-invoices/:id`
- `POST /api/lab-invoices/:id/issue`
- `POST /api/lab-invoices/:id/cancel`
- `GET /api/lab-invoices/:id/pdf`
- `GET|POST /api/lab-invoices/:id/payments`
- `POST /api/lab-invoice-payments/:id/reverse`
- `GET /api/lab-invoice-payments/:id/receipt`
- `GET|POST /api/lab-invoices/:id/credit-notes`
- `GET /api/lab-credit-notes/:id`
- `POST /api/lab-credit-notes/:id/issue`
- `POST /api/lab-invoices/:id/email`
- `GET /api/lab-invoices/:id/deliveries`
- `GET /api/lab-invoices/:id/reversals`
- `GET|PATCH /api/organization/billing`
- `DELETE` on invoice collections returns 405

Organization IDs and payment-derived statuses from the browser are not trusted. Cross-tenant identifiers return 404. Writes use transactions, row locks and unique indexes (one active invoice per order; unique invoice and credit-note numbers per organization).

## Audit

`LAB_INVOICE_CREATED`, `LAB_INVOICE_UPDATED`, `LAB_INVOICE_ISSUED`, `LAB_INVOICE_CANCELLED`, `LAB_PAYMENT_RECORDED`, `LAB_INVOICE_DOWNLOADED`, `LAB_PAYMENT_REVERSED`, `LAB_CREDIT_NOTE_CREATED`, `LAB_CREDIT_NOTE_ISSUED`, `LAB_RECEIPT_DOWNLOADED`, `BILLING_SETTINGS_UPDATED` and `LAB_INVOICE_EMAILED` are written to existing `audit_events`. Metadata may include invoice/order/patient identifiers, amounts, currency, method, reason and recipient. Card PAN/CVV are never stored.

## UI

`/app/billing` lists invoices with snapshot patient/order identity, totals, paid, balance, status and overdue indication. `/app/billing/[id]` shows the frozen billed document separately from the current financial ledger, plus payments, reversals, credit notes, due dates, receipt download, administrator corrections and optional invoice email. `/app/settings` exposes administrator billing defaults. Order detail has a Billing panel separate from results. Patient detail Billing shows invoice history from snapshots plus outstanding ledger balances.

## Phase 9 operations

`009_billing_operations.sql` adds `lab_invoices.due_date`, `lab_invoices.credit_total`, append-only `lab_invoice_payment_reversals`, tenant-scoped `lab_credit_notes` / `lab_credit_note_counters`, and append-only `lab_invoice_deliveries`. Migrations 001–008 are unchanged.

`deriveInvoiceLedger()` is the only ledger calculator. Issued billed totals stay frozen. Persisted `amount_paid` is net paid (gross payments minus reversals). `credit_total` is issued credit notes. `balance_due = billed − net paid − credits`. Status is `PAID` when remaining is zero, `ISSUED` when there is remaining balance with no net payment and no credits, otherwise `PARTIALLY_PAID`. Cancelled invoices cannot be reversed or credited (`INVOICE_NOT_CORRECTABLE`); Phase 8 still forbids payments on cancelled invoices and cancellation after payment/credit.

Credit notes use `CN-YYYY-NNNNNN`, allocated at issue like invoices. Available credit is the remaining ledger balance. Fully paid invoices must be reversed before they can be credited.

Receipt PDFs are generated from the immutable payment row plus the issued invoice snapshot. Later reversals are listed on the receipt without rewriting the original payment. Receipt identifier is the payment UUID.

Due dates are editable on drafts and frozen onto the issued snapshot. Overdue is a derived UI/API flag when `due_date < today`, remaining balance is positive, and the invoice is not draft/cancelled. Overdue never changes clinical workflows or the invoice status model.

Organization currency and default tax are administrator-editable. Changes affect newly created drafts only.

Invoice email uses a provider-neutral stub interface (`features/billing/email.ts`). Staff can send the official snapshot PDF. Delivery rows store recipient and actor, not message bodies. There is no dunning, reminder schedule, or payment link.

## Known limitations

No Stripe/PayPal/card processing, payment links, bank APIs, insurance, fiscalization, government e-invoice APIs, Xero/QuickBooks/DATEV, recurring/subscription billing, multi-order invoices, corporate accounts, collections automation, patient portal payments, or FHIR billing. Production SMTP is not wired; the email provider is a testable stub. Credit-note PDFs are not generated in this phase.
