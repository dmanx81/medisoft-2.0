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
`npm run lint`, `npm run typecheck`, `npm test`, `npm run build:node`. Tests cover permissions, validation, route/session protection, tenant predicates, shell rendering, migration constraints and immutable audit behavior. PostgreSQL engine integration tests run in disposable PGlite; production networking and multi-instance behavior still require a real PostgreSQL deployment smoke test. Dashboard examples are isolated in a development fixture and are rejected in production; production renders an honest empty state until orders exist.

## Phase 2 proposal (not implemented)
Patient CRM: organization-scoped patient records with stable IDs, validated demographic/contact fields, paginated search, duplicate detection and an audited create/update workflow. Define minimum necessary data, retention/access policy and migration/import requirements first. Add cross-tenant negative tests and permission tests before exposing CRUD. No laboratory-result or clinical AI implementation in Phase 2 without separate scope.

## Future domain and integration boundaries
Patient → encounter/visit → laboratory order → specimen → ordered tests → results → validation → report. Future ordered tests/results must snapshot names, units, methods and reference ranges used at the time; finalized results use audited amendments rather than overwrites. Critical values, flags and validation remain deterministic and tested. Barcode, analyzer/HL7/ASTM/FHIR, notifications, accounting and patient portal adapters will sit behind application services when scoped; none are implemented now.

## Phase 2 — Patient CRM
The existing architecture is retained. `features/patients` holds strict shared validation, typed DTOs and permission-enforcing SQL operations; `services/patients.ts` adapts page reads; private `app/api/patients` routes derive identity from sessions and never accept tenant ownership. `components/patients` provides list, form, overview and activity interfaces. Dedicated page routes replace only the patient placeholder.

Migration 002 introduces immutable UUID/display identity, tenant-scoped counters and national-ID uniqueness, composite actor constraints and search indexes. Writes and audit events are transactional; version checks reject stale edits. No patient hard deletion is exposed. Search uses POST bodies, not URLs. New explicit permissions extend existing roles without changing prior grants. Read [patient-crm.md](patient-crm.md) for the detailed design and known limits.

Phase 2 implements the previously proposed Patient CRM scope. Recommended next scope is test catalogue and laboratory order registration, with patient linkage and historical test snapshots; result validation and AI remain deferred.
