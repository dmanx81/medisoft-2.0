# Laboratory test catalogue — Phase 3

## Model
`003_lab_catalogue.sql` adds organization-scoped `lab_test_categories`, `lab_units`, `lab_tests` and `lab_reference_ranges`. Migration 001 and 002 are unchanged. Test identity is the UUID. Codes are unique per organization, so two clinics may both use `GLU`. Optimistic locking uses the same integer `version` pattern as Patient CRM. Test identity (`id`, `organization_id`, `created_at`, `created_by`) is immutable.

## Categories, specimens, units and result types
Categories are an organization-owned table. Laboratories can add their own codes/names; the development seed inserts Hematology, Biochemistry, Hormones, Immunology, Urinalysis, Coagulation and Microbiology.

Specimen type is a controlled CHECK enum (`SERUM`, `PLASMA`, `WHOLE_BLOOD`, `URINE`, `STOOL`, `SWAB`, `SPUTUM`, `OTHER`). Specimen tracking is Phase 4. A closed enum is the simplest option that still migrates cleanly: adding a value is a one-line CHECK change, and Phase 4 can introduce an organization-configurable table later without discarding these values.

Units are a small organization-owned table (`mg/dL`, `mmol/L`, and similar laboratory symbols). There is no conversion ontology.

Result types currently allowed are `NUMERIC`, `TEXT`, `BOOLEAN` and `CATEGORICAL`. Microbiology, panels and calculated tests are deferred; they will be added by migration when those workflows exist. Numeric tests require a unit.

`base_price` is an optional numeric list price on the test. No invoices, payments or billing workflows are implemented.

## Reference ranges and versioning
Ranges are a dedicated table. One test may have several current ranges (for example adult male and adult female hemoglobin). Conditions supported now are sex (`ANY` / `MALE` / `FEMALE`) and age min/max with `YEARS` / `MONTHS` / `DAYS`. Pregnancy, diagnosis, ethnicity, medication and genetic rules are not implemented; additional columns can be added later without rewriting stored ranges.

Clinical content is immutable after insert: bounds, operators, text range, unit, method, sex, age, critical limits, `valid_from`, `range_version` and `supersedes_id` cannot be updated. The only legal mutation is retirement/replacement, which sets `is_active=false`, `valid_to`, `retired_at`, `retired_by` and optional `successor_id`. There is no delete API.

Replacement inserts a new row (`range_version = previous + 1`, `supersedes_id = previous.id`) and then closes the previous row. Historical bounds therefore remain queryable by UUID. Future Phase 5 result records must still snapshot the applied range id, bounds, unit, method and interpretation flags at result time, because the parent test’s default unit/method/name can change. The stored range row is the audit-safe source for the bounds that were current at that moment.

Critical low/high are stored for later flagging. Phase 3 does not interpret results or raise alerts.

## Access, tenancy and audit
Named permissions extend the existing map: `tests:read`, `tests:create`, `tests:edit`. Organization and platform administrators receive all permissions. Biochemists may create and edit. Laboratory technicians and receptionists may read (receptionists will need the catalogue when ordering). Viewers and doctors have no catalogue access in this phase. Every query predicates on the authenticated principal’s organization. Cross-tenant UUIDs return the same 404 as missing records.

Mutations write append-only audit events (`LAB_TEST_CREATED`, `LAB_TEST_UPDATED`, `LAB_TEST_STATUS_CHANGED`, `LAB_TEST_CATEGORY_CHANGED`, `LAB_CATEGORY_CREATED`, `LAB_UNIT_CREATED`, `REFERENCE_RANGE_CREATED`, `REFERENCE_RANGE_RETIRED`, `REFERENCE_RANGE_REPLACED`). Metadata contains field names and successor ids, never bounds or prices as old/new values.

## Application UI
The existing Management → Tests route `/app/management/tests` lists, searches and filters tests. Create, edit, detail, activate/deactivate and range add/retire/replace are implemented. Hard deletion of tests or ranges is not exposed.

## Future snapshots
Phase 4 orders copy test code, name, unit, method, specimen expectation and price onto ordered-test rows at order time. See [lab-orders-specimens.md](lab-orders-specimens.md). Phase 5 results should copy result type, measured value, unit, method, reference-range id and bounds, and a deterministic abnormal/critical flag. Changing the catalogue later must not rewrite those snapshots.

## Auth hardening included with this migration
Successful logins no longer increment the account throttle; failures do, and a successful login resets the counter. Updating `users.password_hash` deletes that user’s sessions.

## Boundaries
No orders, specimens, barcodes, result entry, validation, reports, billing, microbiology, analyzer/HL7/FHIR adapters or clinical AI are included. Overlapping active ranges are not rejected; Phase 5 must define deterministic range selection. Contains-search may scan the current tenant’s catalogue; add trigram indexes if needed.
