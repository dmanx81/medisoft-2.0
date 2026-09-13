# Laboratory orders and specimens — Phase 4

Phase 4 adds organization-scoped laboratory orders, catalogue snapshots at order time, specimen collection/accessioning, and an explicit specimen ↔ ordered-test relationship. Results, validation and reports were later phases. Laboratory billing in Phase 8 reads those ordered-test price snapshots; see [lab-billing.md](lab-billing.md). Analyzers remain out of scope.

## Schema

`004_lab_orders_specimens.sql` adds:

- `lab_order_counters` / `lab_accession_counters` — per-organization, per-year sequences
- `lab_orders` — one clinical order for a patient
- `lab_order_tests` — requested tests with catalogue snapshots
- `lab_specimens` — collected/received/rejected containers
- `lab_specimen_tests` — links a specimen to one or more ordered tests on the **same** order and organization

Migrations 001–003 are unchanged. Composite foreign keys prevent cross-tenant and cross-order links. Clinical identity columns and ordered-test snapshots are immutable after insert. `lab_orders`, `lab_specimens` and `lab_specimen_tests` cannot be deleted. Draft ordered tests may be physically removed before the order is placed.

```text
Patient 1──* LabOrder 1──* LabOrderTest
                 │                │
                 │                │
                 └──* LabSpecimen *── LabSpecimenTest
```

One specimen may cover several ordered tests (for example a serum tube for GLU and ALT). Different specimen types on the same order cover different tests (whole blood for CBC). There is not one specimen per ordered test.

## Order numbers

Every order receives a server-generated number at insert time, including drafts. The browser cannot supply the authoritative value.

Strategy: `INSERT INTO lab_order_counters(organization_id, year, last_number) … ON CONFLICT DO UPDATE SET last_number = last_number + 1 RETURNING …` inside the same transaction as the order insert, after `SELECT … FROM organizations WHERE id=$1 FOR UPDATE`. Format: `LAB-{year}-{6-digit sequence}`, for example `LAB-2026-000123`. Unique per organization. Never reused. Stable after creation.

This matches the Patient CRM counter pattern and does not use `MAX(number)+1`.

## Accession numbers

Every specimen receives a server-generated accession at insert time. Format: `ACC-{year}-{6-digit sequence}` from `lab_accession_counters` with the same conflict-safe increment. Unique per organization, immutable, independent of the order number. One order may have many accessions.

## Catalogue snapshots

When a test is added, the ordered-test row copies code, name, short name, specimen type, result type, unit symbol, method and list price from the current catalogue row. `lab_test_id` remains as a reference. Later catalogue edits do not mutate historical snapshots. Only **active** catalogue tests may be newly ordered. Inactive tests already on an order stay visible with their original snapshot. Duplicate `lab_test_id` values on one order are rejected.

## Order status

Stored status is updated only by server actions. Collection/receipt progress is derived from specimen coverage of non-cancelled ordered tests.

- `DRAFT` — editable; no specimens
- `ORDERED` — placed; no covering collected/received specimen yet
- `PARTIALLY_COLLECTED` — some, but not all, active tests have a COLLECTED or RECEIVED specimen
- `COLLECTED` — every active test is covered, but not every covering specimen is RECEIVED
- `RECEIVED` — every active test is covered by a RECEIVED specimen
- `IN_PROCESS` — result entry has started (Phase 5)
- `COMPLETED` — every active ordered test has a current clinically verified result (Phase 6)
- `CANCELLED` — terminal; history retained

Legal transitions:

- `DRAFT → ORDERED` via `POST …/place` (requires at least one test)
- `DRAFT | ORDERED → CANCELLED` via `POST …/cancel` with a reason
- Collection/receipt/rejection drive `ORDERED ↔ PARTIALLY_COLLECTED ↔ COLLECTED ↔ RECEIVED`

There is no generic status PATCH. Invalid transitions return `INVALID_ORDER_TRANSITION` or `INVALID_ORDER_STATUS`. `CANCELLED → ORDERED` and `RECEIVED → DRAFT` fail.

### Editing policy

Drafts: patient, tests, priority and notes may change. Draft ordered tests may be physically deleted (`LAB_ORDER_TEST_REMOVED`).

After `ORDERED`: contents are not rewritten. Tests cannot be added or removed. Individual test cancellation is not a Phase 4 product action except as part of whole-order cancellation (status `CANCELLED` on the ordered-test rows).

Whole-order cancellation is refused once any specimen has been collected (status is no longer `DRAFT`/`ORDERED`). Specimens already collected would otherwise be left on a cancelled order; Phase 4 prefers that conservative rule.

## Specimen status

Specimens begin at `COLLECTED` (no unused `EXPECTED` records).

- `COLLECTED → RECEIVED`
- `COLLECTED | RECEIVED → REJECTED` (reason, actor, timestamp required)

Rejected rows are retained. A replacement is a **new** specimen.

Phase 4 reuses the Phase 3 closed specimen-type enum unchanged (`SERUM`, `PLASMA`, `WHOLE_BLOOD`, `URINE`, `STOOL`, `SWAB`, `SPUTUM`, `OTHER`). There is no configurable specimen catalogue and no multiple permitted types per test. Compatibility is an exact match against the ordered-test snapshot, except a test expecting `OTHER` may attach to any of those types. A serum specimen cannot cover a whole-blood test.

## Permissions

Named grants extend the existing map:

| Role | Orders | Specimens |
|---|---|---|
| ORG_ADMIN / PLATFORM_ADMIN | read, create, edit drafts, place, cancel | collect, receive, reject |
| RECEPTIONIST | read, create, edit drafts, place | none |
| LAB_TECHNICIAN | read (plus `patients:read` for laboratory work) | collect, receive, reject |
| BIOCHEMIST | read (plus `patients:read`) | collect, receive, reject |
| DOCTOR | read (Phase 5) | none |
| VIEWER | none | none |

Catalogue administration is unchanged. Hidden buttons are not security; repository/API checks remain authoritative. Cross-tenant UUIDs return the same 404 as missing records (`ORDER_NOT_FOUND`, `PATIENT_NOT_FOUND`, `SPECIMEN_NOT_FOUND`).

## Audit

Append-only events include `LAB_ORDER_CREATED`, `LAB_ORDER_UPDATED`, `LAB_ORDER_PLACED`, `LAB_ORDER_CANCELLED`, `LAB_ORDER_TEST_ADDED`, `LAB_ORDER_TEST_REMOVED`, `LAB_ORDER_TEST_CANCELLED`, `SPECIMEN_CREATED`, `SPECIMEN_COLLECTED`, `SPECIMEN_RECEIVED`, `SPECIMEN_REJECTED`, `SPECIMEN_TEST_LINKED`. Metadata holds identifiers, field names, from/to status and reason text where clinically required — not copied patient notes or prices as old/new values.

## APIs

Explicit commands, not unrestricted PATCH:

- `POST /api/lab-orders` create draft (optional `place: true`)
- `POST /api/lab-orders/search`
- `GET|PATCH /api/lab-orders/[id]` (PATCH drafts only)
- `POST /api/lab-orders/[id]/place`
- `POST /api/lab-orders/[id]/cancel`
- `POST /api/lab-orders/[id]/tests` / `DELETE …/tests/[testId]` (draft only)
- `POST /api/lab-orders/[id]/specimens`
- `POST /api/lab-specimens/[id]/receive`
- `POST /api/lab-specimens/[id]/reject`

Organization, actors, order numbers and accession numbers cannot be mass-assigned from the browser.

## UI

`/app/laboratory/orders` lists orders. `/app/laboratory/orders/new` selects a patient and active tests, shows expected specimen types, then saves a draft or places the order. `/app/laboratory/orders/[id]` shows the patient, snapshots, specimens, collection/receipt/rejection actions and activity. The patient record Lab Orders tab lists that patient’s orders when the role can read orders.

## Known limitations

No analyzers, HL7/FHIR, barcode hardware, label printers, panels, configurable specimen catalogues, aliquots, microbiology/pathology workflows or AI. Overlapping collection of the same test is blocked while a collected/received specimen already covers it; a rejected specimen can be replaced. STAT priority is not implemented. Doctors can read orders and results in Phase 5. Official reports are in [lab-reports.md](lab-reports.md). Laboratory invoicing is in [lab-billing.md](lab-billing.md).
