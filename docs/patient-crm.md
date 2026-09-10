# Patient CRM — Phase 2

## Model and identity
`002_patient_crm.sql` adds `patients` and `patient_counters`; migration 001 is unchanged. Patients have UUID primary keys, organization ownership, display numbers, optional demographic/contact/address/emergency fields, administrative notes, language, ACTIVE/INACTIVE status, creation/update actors and an integer edit version. No results or diagnoses live on this table. First/last name are mandatory; sex defaults to UNKNOWN. Country and birth date may be omitted.

`PAT-000001` is a display number, not an authorization key. A per-organization counter is incremented in the same transaction as patient creation and audit insertion. The unique `(organization_id, patient_number)` constraint is the final safeguard. Failed transactions roll back number allocation. Numbers can grow beyond six digits and sort numerically. Ownership, UUID, display number and creation metadata are immutable at the database layer.

## Access and tenancy
Admins and receptionists can read/create/edit patients and read activity. Doctors can read patients only. Other initial roles have no patient access. Named permissions are `patients:read`, `patients:create`, `patients:edit`, `patients:activity`. Platform administrators retain the Phase 1 rule: no cross-tenant bypass.

Every API checks the database-backed session and permission. Every repository read, search, update, duplicate check and activity lookup receives the trusted principal and predicates on organization ID. Composite foreign keys ensure actors belong to the same organization. Strict schemas reject submitted organization ownership, IDs and creation metadata. Cross-tenant UUIDs produce the same 404 as missing records. No hard-delete route or UI exists; use Inactive to retain historical identity. Runtime database roles should have no DELETE/TRUNCATE on patients and no audit mutation privileges.

This continues Phase 1 application/query isolation; it does not introduce or claim database row-level security. Database owners remain privileged. Future modules should reference `(organization_id, patient_id)` with composite foreign keys.

## Lookup and privacy
`POST /api/patients/search` accepts search, page, page size, sort direction and status in JSON. Personal search terms are never placed in browser URLs. Results are database-filtered and paginated, with a 50-row maximum; the UI uses 20. Only list fields are returned, excluding national ID, notes and address. Exact normalized national ID, digit-normalized phone substrings, literal case-insensitive names/email/patient number are supported. Wildcards are escaped; sort columns are allowlisted and UUID is the stable tie-breaker.

Patient UUIDs, non-sensitive activity page numbers and save-confirmation flags may appear in URLs. Document titles contain no patient names. API responses are private/no-store; pages are dynamic under the protected app layout. Referrers are suppressed on patient pages/API responses. No payload logging, browser persistence, telemetry, export or external calls are added.

## Creation, editing and duplicates
The shared Zod schema validates browser forms and server mutations. JSON request size is bounded. Mutation origins must match APP_ORIGIN. Client field errors explain invalid input; the server remains authoritative.

Exact national ID duplicates within an organization are blocked, including after warning acknowledgment. Normalization removes ASCII spaces/hyphens/nonalphanumeric characters and folds case; a partial unique index enforces the rule under races. Potential matches by full name + date of birth, primary phone or email produce a 409 warning with up to ten minimal matching records. Staff can open the existing record or explicitly acknowledge a separate patient. Both active and inactive records participate. Editing excludes the current record. No cross-organization matches are returned.

Creation/edits lock the organization row for the short write transaction to serialize duplicate checks and number allocation. This deliberately favors correctness and simplicity for a small number of clinics. Update version checks reject stale forms with 409; users must reload before saving. Creation metadata remains unchanged. Every actual update increments version and updates actor/time. A no-op edit does not create noise in the audit log.

## Activity
Patient creation, updates and status changes append events in the existing audit table within the mutation transaction. Failure to audit rolls back the patient write. Metadata contains only changed field names, never old/new patient values. The Activity tab is separately permission-gated and loads 20 events at a time. The append-only triggers remain unchanged. Live offset pagination may shift when new events arrive; a cursor can replace it when activity volume grows.

## Development data
The existing seed adds three clearly synthetic patients per development organization, a second organization, and a disabled secondary fixture user. Fixed UUIDs make reruns idempotent even after staff edit fields; existing patients and passwords are not overwritten. There is no default password or second-tenant login. The primary administrator still uses caller-supplied seed credentials. `--dry-run` performs no writes; production seed execution is blocked. Run migration 002 before seeding. Never run development seeds against a live clinical database.

## Boundaries and known limitations
This phase includes no clinical module implementation or LLM execution. Overview and activity work; Lab Orders, Results, Documents and Billing are explicit future sections. AI interfaces remain provider-neutral and unchanged.

Contains searches may scan the current organization's rows despite tenant/name/contact indexes. Measure query plans before scaling; add PostgreSQL trigram indexes or dedicated search when justified. Phone matching removes formatting only, without country-aware E.164 normalization. National ID formatting is generic, not country-specific validation. There is no merge workflow, identity verification service, field-level masking, data export, erasure workflow or regulatory compliance claim. Address access/recovery/MFA and deployment backup/restore controls from Phase 1 remain rollout prerequisites.

## Suggested Phase 4
Laboratory orders and specimens linked to the patient UUID, with tenant-safe ordered-test snapshots of catalogue code/name/unit/method/price, explicit status transitions, authorization and audit tests. Keep result entry, validation, billing, integrations and AI out of that phase until separately specified.
