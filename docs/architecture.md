# MEDISOFT architecture — Phases 0 and 1

## Inspection and decision
The original repository is a clean marketing website: React 19, strict TypeScript, Tailwind 4, Base UI/shadcn primitives and Lucide icons. `app/[locale]` serves English and Albanian landing/content pages and the interactive demo. `/` redirects to `/en`. `/login` was a visual preview without authentication. There were no API routes, database, environment schema, authorization or application models. Shared colors are ink, teal and ivory; public components and dictionaries remain unchanged.

Although it uses Next.js App Router APIs, the original runtime is **Vinext beta on Vite/Cloudflare Workers**, not Next.js. Phase 1 makes standard Next.js Node scripts the default (retaining Sites scripts under `:sites`) for PostgreSQL and portable Docker deployments; the existing Sites/Vinext configuration is retained as deployment history, not a supported PostgreSQL production target. Raw PostgreSQL TCP connections cannot run on hosted Sites. No live service is replaced by this change.

## Application boundaries and routing
`/en/*`, `/sq/*` and their demos remain public. `/login` posts to the server authentication endpoint. `/app` and `/app/*` require a current database session; every page/service independently checks identity/permissions, because a layout alone is not a sufficient authorization boundary. Application UI lives in `components/application`; marketing components remain in `components/site`. Both reuse design tokens. Initial application labels are English; organization language stores en/sq for subsequent application localization.

Modules: dashboard; patients; laboratory orders/samples/results; reports; doctors; billing; test catalogue; users; settings. Phase 1 implemented dashboard and navigation. Phase 2 now adds Patient CRM with create/read/update, scoped search and activity; other clinical modules remain permission-checked empty states.

## Database and tenancy
PostgreSQL, explicit versioned SQL migrations, parameterized queries using `pg`, and a small service/data-access layer. A user belongs to one organization in this phase; email is unique globally. Future multi-organization membership requires an explicit membership table and migration. All organization-owned tables carry organization_id; composite foreign keys prevent cross-organization references. A request principal is assembled from a live session/user lookup, never a browser-supplied organization ID. Tenant helpers add explicit organization predicates. No implicit PLATFORM_ADMIN tenant bypass: platform staff act within their assigned organization until an audited support-access workflow exists.

Tenant isolation is enforced in server services and constraints, not client filtering. PostgreSQL RLS is a future defense-in-depth option, not claimed as implemented. Future resource repositories must require the authenticated principal and include organization predicates in every read/write. Integration tests exercise two organizations.

## Authentication and authorization
Opaque random session tokens in HttpOnly, SameSite=Lax cookies; Secure in production, eight-hour absolute expiry. Only token SHA-256 digests are stored. Passwords use salted scrypt; credentials never enter logs. Login input is validated, cross-origin POSTs rejected against configured APP_ORIGIN, and database-backed per-account throttling applies across instances. Login/session creation and audit event are transactional. Logout revokes the session and records an audit event transactionally. Disabled users lose access immediately. Failures expose generic messages.

Named permissions map to the initial seven roles. Navigation filtering is convenience only: server pages and services enforce permissions. Roles can later be replaced with organization-managed grants without changing feature checks. Enrollment and password recovery are operator-run in this phase; no public signup. Before customer rollout: implement audited invitations/recovery, MFA policy, monitoring and tested restore procedures.

## Audit
Append-only audit_events contain organization, actor, action, entity type/ID, timestamp, session digest and allowlisted metadata. Database triggers reject UPDATE/DELETE/TRUNCATE; privileged database owners remain capable of changing schema, so this is not cryptographic tamper resistance. Runtime credentials must not own schema or have DDL permissions. Never log patient data, request bodies, passwords or cookies; IP capture is deferred until a trusted proxy policy exists.

## AI extension
Provider-neutral types in `services/ai/types.ts`; no SDK, LLM calls or UI. AI is disabled per organization by default. Future application services check organization settings and action permissions, assemble minimal context, audit requests, then invoke an injected provider. Providers never get a database connection. Responses are advisory drafts, require human review, and cannot mutate/validate results, diagnose authoritatively, prescribe, or bypass audit/permissions.

## Deployment and operations
Standard Next.js Node runtime plus PostgreSQL for VPS or customer Docker. `.env.example` describes validated settings; secrets are runtime-only. Docker Compose includes an isolated database and app, a named volume and database health check. Migrations are an explicit operator step, never automatic application startup. Use separate owner credentials for migrations and limited runtime credentials in production. Terminate HTTPS at the existing proxy, configure APP_ORIGIN exactly, and preserve existing domains/SSL. No server deployment is part of this implementation. Keep encrypted database backups and rehearse restores before production data.

## Testing
`npm run lint`, `npm run typecheck`, `npm test`, `npm run build:node`. Tests cover permissions, validation, route/session protection, tenant predicates, shell rendering, migration constraints and immutable audit behavior. PostgreSQL engine integration tests run in disposable PGlite; production networking and multi-instance behavior still require a real PostgreSQL deployment smoke test. Dashboard examples are isolated in a development fixture and are rejected in production; production renders an honest empty state until orders exist. Phase 5 adds result flags, range selection, workflow transitions, amendments, tenant isolation and RBAC tests. Phase 6 adds order completion, report snapshots, PDF download, versioning, delivery records, tenant isolation and RBAC tests. Phase 7 adds secure report sharing, hashed tokens/PINs, expiry/revocation, public snapshot-only PDFs and share RBAC tests. Phase 8 adds invoice snapshots, payment ledgers, PDF download, tenant isolation and billing RBAC tests.

## Phase 2 proposal (not implemented)
Patient CRM: organization-scoped patient records with stable IDs, validated demographic/contact fields, paginated search, duplicate detection and an audited create/update workflow. Define minimum necessary data, retention/access policy and migration/import requirements first. Add cross-tenant negative tests and permission tests before exposing CRUD. No laboratory-result or clinical AI implementation in Phase 2 without separate scope.

## Future domain and integration boundaries
Patient → encounter/visit → laboratory order → specimen → ordered tests → results → validation → report. Future ordered tests/results must snapshot names, units, methods and reference ranges used at the time; finalized results use audited amendments rather than overwrites. Critical values, flags and validation remain deterministic and tested. Barcode, analyzer/HL7/ASTM/FHIR, notifications, accounting and patient portal adapters will sit behind application services when scoped; none are implemented now.

## Phase 2 — Patient CRM
The existing architecture is retained. `features/patients` holds strict shared validation, typed DTOs and permission-enforcing SQL operations; `services/patients.ts` adapts page reads; private `app/api/patients` routes derive identity from sessions and never accept tenant ownership. `components/patients` provides list, form, overview and activity interfaces. Dedicated page routes replace only the patient placeholder.

Migration 002 introduces immutable UUID/display identity, tenant-scoped counters and national-ID uniqueness, composite actor constraints and search indexes. Writes and audit events are transactional; version checks reject stale edits. No patient hard deletion is exposed. Search uses POST bodies, not URLs. New explicit permissions extend existing roles without changing prior grants. Read [patient-crm.md](patient-crm.md) for the detailed design and known limits.

Phase 2 implements the previously proposed Patient CRM scope. Phase 3 implements the laboratory test catalogue and versioned reference ranges; see [lab-catalogue.md](lab-catalogue.md). Phase 4 implements laboratory orders and specimens; see [lab-orders-specimens.md](lab-orders-specimens.md). Phase 5 implements results, technical validation, clinical verification and amendments; see [lab-results.md](lab-results.md). Phase 6 implements order completion, issued laboratory reports, PDFs and delivery records; see [lab-reports.md](lab-reports.md). Phase 7 implements secure patient/recipient report sharing; see [lab-report-sharing.md](lab-report-sharing.md). Phase 8 implements laboratory invoicing and payments; see [lab-billing.md](lab-billing.md). AI remains deferred.

## Phase 4 — Laboratory orders and specimens
Orders, ordered-test snapshots and specimens follow the same tenant, permission, audit and optimistic-concurrency patterns as Patient CRM and the catalogue. `features/orders` owns validation and SQL; `app/api/lab-orders` and `app/api/lab-specimens` derive the principal from the session. Order and accession numbers use per-organization yearly counters with `INSERT … ON CONFLICT DO UPDATE`, not `MAX+1`. Specimen–test links use composite foreign keys so a specimen cannot attach to another organization’s or another order’s tests. Collection progress is derived server-side. Hard deletion of clinical order/specimen rows is blocked in the database.

## Phase 5 — Laboratory results
Results attach to ordered tests through `features/results`. `005_lab_results.sql` adds `lab_results` and `IN_PROCESS` order status. Flags, reference-range selection, snapshots, validation, verification and amendments are server-enforced. Doctors receive `orders:read` so they can view orders and results; they cannot enter, validate, verify or amend. See [lab-results.md](lab-results.md).

## Phase 6 — Laboratory reports
Order completion, issued report snapshots, on-demand PDFs, version history and delivery records follow the same tenant, permission and audit patterns. `006_lab_reports.sql` adds `COMPLETED` order status, `lab_reports` and append-only `lab_report_deliveries`. Report generation is downstream of clinically verified results and never sets completion. See [lab-reports.md](lab-reports.md).

## Phase 7 — Secure report sharing
Issued reports can be shared through expiring, revocable bearer links plus an 8-digit access PIN. Public pages and PDFs reconstruct clinical content only from `lab_reports.snapshot` (with immutable report-row fallback for legacy snapshots). Raw tokens and PINs are never persisted. See [lab-report-sharing.md](lab-report-sharing.md).

## Phase 8 — Laboratory billing
Issued invoices freeze a financial snapshot at issuance, the same way reports freeze clinical content. Payments are append-only and change balance/status only. `features/billing` owns decimal-safe totals, snapshot construction, PDF rendering and permission-enforcing SQL. `008_billing.sql` adds invoice/payment tables plus organization currency and default tax rate. Clinical completion and reporting are independent of payment. See [lab-billing.md](lab-billing.md).
