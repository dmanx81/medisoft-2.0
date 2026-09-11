# Laboratory results — Phase 5

Phase 5 adds organization-scoped laboratory results on ordered tests, result-time interpretation snapshots, deterministic abnormal/critical flags, technical validation, clinical verification and append-only amendments. Billing, reports/PDFs, analyzers and interoperability remain out of scope.

## Schema

`005_lab_results.sql` adds `lab_results` and extends order status with `IN_PROCESS`. Migrations 001–004 are unchanged.

A result belongs to `lab_order_tests`, not to a specimen. Composite foreign keys `(organization_id, order_id, order_test_id)` prevent cross-tenant and cross-order attachment. One current result exists per ordered test (`UNIQUE (organization_id, order_test_id) WHERE is_current`).

Result identity, ordered-test linkage and `supersedes_id` are immutable after insert. Clinical value and interpretation snapshots cannot change once status is no longer `ENTERED`. Rows cannot be deleted.

## Result-time snapshots

Phase 4 ordered-test catalogue snapshots remain untouched. At result entry the server copies:

- ordered-test result type, unit symbol and method
- selected reference-range id and version, when one applies
- sex, numeric bounds, operators, text range, unit, method
- critical low/high when present

Later catalogue or range edits do not rewrite historical results.

## Reference-range selection

Selection uses existing patient sex and date of birth only. UNKNOWN/INTERSEX match `ANY` ranges. MALE/FEMALE may match a sex-specific range or `ANY`. Age uses the range’s `age_unit`. Missing date of birth matches only unbounded-age ranges. Empty range method/unit match any ordered-test snapshot; otherwise they must match. Inactive or expired ranges are ignored. If nothing applies, the result is stored without bounds and flagged `UNINTERPRETED`. Specificity prefers sex-specific, then age-specified, method-specified, unit-specified, latest `valid_from`, then id.

## Flags

The server calculates flags. The browser cannot supply them.

Numeric results with a frozen range:

- critical low/high use `<=` / `>=` when those bounds exist
- otherwise LOW/HIGH follow GE/GT and LE/LT operators
- exact lower bound is NORMAL for GE and LOW for GT
- exact upper bound is NORMAL for LE and HIGH for LT

Non-numeric results and numeric results without a selected range are `UNINTERPRETED`.

## Workflow

Statuses stay separate:

- order: `RECEIVED` → `IN_PROCESS` on first result entry (`IN_PROCESS` is sticky and is not derived back to RECEIVED)
- ordered test: `ACTIVE` | `CANCELLED`
- specimen: `COLLECTED` | `RECEIVED` | `REJECTED`
- result: `ENTERED` → `TECHNICALLY_VALIDATED` → `CLINICALLY_VERIFIED`; amendments mark the predecessor `SUPERSEDED`

Entry requires an `ACTIVE` ordered test covered by a `RECEIVED` specimen on a `RECEIVED` or `IN_PROCESS` order. `ENTERED` rows may be updated in place. After technical validation, values cannot be overwritten; clinically verified rows are corrected only by amendment.

Invalid transitions return `INVALID_ORDER_STATUS`, `INVALID_RESULT_STATUS` or `INVALID_RESULT_TRANSITION`.

## Amendments

Only the current `CLINICALLY_VERIFIED` result may be amended. A reason is required. The original row stays unchanged except `is_current=false`, `status=SUPERSEDED` and `successor_id`. The new row starts at `ENTERED` with `supersedes_id` and the reason, and must be validated and verified again.

## Permissions

- `results:read` — LAB_TECHNICIAN, BIOCHEMIST, DOCTOR, ORG_ADMIN, PLATFORM_ADMIN
- `results:enter` / `results:validate` — LAB_TECHNICIAN, BIOCHEMIST, administrators
- `results:verify` / `results:amend` — BIOCHEMIST, administrators

Doctors can read orders and results. Receptionists can read orders but do not receive result values. VIEWER has neither.

## APIs

- `GET /api/lab-orders/:id` attaches results when the caller has `results:read`
- `GET /api/lab-orders/:id/tests/:testId/result-context`
- `POST /api/lab-orders/:id/tests/:testId/results`
- `POST /api/lab-results/:id/validate`
- `POST /api/lab-results/:id/verify`
- `POST /api/lab-results/:id/amend`
- `GET /api/lab-results/:id/history`
- `POST /api/lab-results/search`
- `DELETE /api/lab-results/:id` returns 405

Organization, actors, flags, bounds and interpretation cannot be mass-assigned from the browser.

## Audit

Append-only `audit_events` records `RESULT_ENTERED`, `RESULT_UPDATED`, `LAB_ORDER_IN_PROCESS`, `RESULT_TECHNICALLY_VALIDATED`, `RESULT_CLINICALLY_VERIFIED` and `RESULT_AMENDED`.

## UI

`/app/laboratory/results` lists received and in-process orders. `/app/laboratory/orders/:id` shows result entry, flags, validation, verification, amendments and history on each ordered test.

## Known limitations

No PDF reports, result delivery, order-completed status after every test is verified, analyzer import, HL7/FHIR, patient portal, QC, billing or AI interpretation.

## Phase 6 handoff

Laboratory reports/PDFs and delivery of clinically verified results, plus an order-level completed status once every active ordered test has a current clinically verified result.
