# MEDISOFT 2.0

Phase 1 adds the authenticated application foundation. Public English `/en`, Albanian `/sq`, demo and login branding remain intact. See [architecture](docs/architecture.md) for decisions, current limitations and later phases.

## Local development

Node 22.13+ and PostgreSQL 17 are recommended. Use `npm ci`, copy `.env.example` to `.env.local`, and set your own database password. Do not commit environment files.

```sh
npm ci
cp .env.example .env.local
# Edit .env.local with your database URL and APP_ORIGIN=http://localhost:3000.
# PostgreSQL can run independently, or use the Compose database:
docker compose --env-file .env.local up -d db
node --env-file=.env.local --import tsx scripts/migrate.ts
# Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (14+ characters) in .env.local.
node --env-file=.env.local --import tsx scripts/seed.ts --dry-run
node --env-file=.env.local --import tsx scripts/seed.ts
npm run dev:node
```

Visit `/login` and sign in with the credentials you supplied. No default password or public registration exists. The seed preserves existing users/passwords and fails on conflicting organization membership. Set `DASHBOARD_DEMO=true` only in development to display synthetic orders and counts. Otherwise the dashboard has an empty state. Phase 2 adds six synthetic patient records across two development organizations; Phase 3 adds a synthetic laboratory catalogue (including a shared `GLU` code in both organizations); Phase 4 adds `ALT` and `CBC` in the primary organization plus a synthetic John Test patient. No real patient or clinical data is used.

`npm run db:migrate` and `npm run db:seed` also work when the environment is already exported; the explicit Node commands above load `.env.local` without shell sourcing. Next.js loads `.env.local` itself. A missing database/configuration produces a generic authentication failure and never enables a bypass.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run test:api
npm run build:node
```

Tests use disposable PGlite databases (actual PostgreSQL engine, no external database needed). They cover role grants, validation, origin/session rejection, password hashing, organization isolation, composite foreign keys, session expiry/disabled users, audit immutability, Patient CRM, the laboratory catalogue, laboratory orders/specimens, laboratory results, laboratory reports, report sharing, laboratory billing and rendered dashboard structure. HTTP route-protection smoke checks should run against `npm run dev:node` or `npm run start:node`: anonymous `/app` and nested application URLs redirect to `/login`; public `/en`, `/sq` and both demos remain accessible.

## Deployment

The application uses standard **Next.js on Node + PostgreSQL**, independent of cloud provider. `npm run build:node` creates standalone output; `npm run start:node` starts the normal production server. `Dockerfile` packages standalone output. `compose.yaml` is an isolated starting point; it does not modify an existing VPS or proxy.

The original scripts are retained as `dev:sites`, `build:sites`, `start:sites`, alongside Sites/Vinext/Cloudflare configuration for deployment history. `dev`, `build`, `start` now use standard Next.js; the explicit `:node` aliases do the same. They are **not the supported PostgreSQL application deployment**; use the standard or `:node` scripts for Phase 1. Hosted Sites cannot use this application's direct PostgreSQL connection. Do not publish this application through the old Sites pipeline.

Before deploying, configure HTTPS `APP_ORIGIN`, a production database, migration-owner and limited runtime credentials. Docker app DATABASE_URL uses hostname `db`; host-side migrations use `localhost`. Run migrations explicitly against the target database before starting the app. Do not run the development seed in production. Initial production account provisioning, recovery/invitations and MFA need an audited operator workflow before customer onboarding.

```sh
# With deployment-specific environment values already set:
docker compose config --quiet
# Start database first, run migrations using the owner connection, then:
docker compose up -d --build app
```

Keep ports bound to localhost behind the existing HTTPS reverse proxy. Give runtime credentials SELECT/INSERT/UPDATE on organizations/users as needed, SELECT/INSERT/DELETE on sessions, SELECT/INSERT/UPDATE on login_limits, and INSERT/SELECT only on audit_events; no schema ownership, DDL, audit mutation or truncate privileges. Grant the same SELECT/INSERT/UPDATE pattern on patients, patient_counters, lab_test_categories, lab_units, lab_tests, lab_reference_ranges, lab_orders, lab_order_tests, lab_specimens, lab_specimen_tests, lab_order_counters, lab_accession_counters, lab_results, lab_reports, lab_report_deliveries, lab_report_shares, lab_invoices, lab_invoice_counters, lab_credit_notes and lab_credit_note_counters. Grant SELECT/INSERT/DELETE on lab_report_share_sessions. Grant SELECT/INSERT/UPDATE on share_access_limits. Grant INSERT/SELECT on lab_invoice_payments, lab_invoice_payment_reversals and lab_invoice_deliveries. Grant DELETE on `lab_order_tests` only (draft test removal before an order is placed). Do not grant DELETE on `lab_report_shares`, `lab_invoices`, `lab_invoice_payments`, `lab_invoice_payment_reversals`, `lab_credit_notes` or `lab_invoice_deliveries`. Do not grant DELETE/TRUNCATE on patient, catalogue, order or specimen tables otherwise. Rehearse encrypted backups and restores. Never delete the named volume during upgrades. Back up before migrations; applied migrations have checksums and must not be edited.

Authentication uses database sessions with 8-hour expiry, HttpOnly cookies, production Secure cookies, origin checks and a shared 5-attempt/15-minute account throttle. A perimeter request-size and IP rate limit is also recommended before public rollout. Logs must never contain credentials, request bodies, patient records or session tokens. Expired session/throttle maintenance is an operator task; no raw/audit data cleanup is provided. Production operators should follow [operations](docs/operations.md).

## Scope

Organization/user/role schema, login/logout, protected shell, dashboard, module empty states, audit foundation and provider-neutral AI contracts are implemented. AI defaults off and no model calls exist. Patient CRM is implemented in Phase 2. The laboratory test catalogue and versioned reference ranges are implemented in Phase 3. Laboratory orders and specimen collection are implemented in Phase 4. Laboratory results, technical validation, clinical verification and amendments are implemented in Phase 5. Order completion, laboratory reports, PDF generation and delivery records are implemented in Phase 6. Secure patient report delivery and sharing are implemented in Phase 7. Laboratory billing, invoicing and manual payment recording are implemented in Phase 8. Payment reversals, credit notes, receipt PDFs, due dates, billing settings and manual invoice email are implemented in Phase 9. User management remains future work.

**Phase 2:** organization-scoped Patient CRM is implemented. See [Patient CRM](docs/patient-crm.md) for schema, permissions, duplicate handling, audit behavior and limitations.

**Phase 3:** organization-scoped laboratory catalogue is implemented. See [Laboratory catalogue](docs/lab-catalogue.md) for schema, versioning, permissions, audit behavior and limitations.

**Phase 4:** laboratory orders, ordered-test snapshots and specimen collection/accessioning are implemented. See [Laboratory orders and specimens](docs/lab-orders-specimens.md).

**Phase 5:** laboratory results, technical validation, clinical verification and amendments are implemented. See [Laboratory results](docs/lab-results.md).

**Phase 6:** order completion, issued laboratory reports, PDFs and delivery records are implemented. See [Laboratory reports](docs/lab-reports.md).

**Phase 7:** secure, expiring report shares, PIN verification and snapshot-only public PDFs are implemented. See [Laboratory report sharing](docs/lab-report-sharing.md).

**Phase 8:** laboratory invoices, frozen financial snapshots, PDFs and append-only payments are implemented. See [Laboratory billing](docs/lab-billing.md).
**Phase 9:** payment reversals, credit notes, receipt PDFs, due dates, organization billing settings and manual invoice email are implemented on top of Phase 8. Analyzers remain future work.
**Phase 10:** production configuration validation, security headers, health/readiness, SMTP or explicitly disabled email, backup/restore scripts and the operations runbook. No public-domain deployment. See [operations](docs/operations.md).

Run HTTP boundary checks against a running server with `SMOKE_ORIGIN=http://localhost:3000 npm run test:http` (APP_ORIGIN must match). These verify every module redirect, public bilingual routes, origin checks, oversized form rejection and invalid credentials.

Lint keeps all checks on application code; scoped overrides account for inherited generic UI primitive patterns (polymorphic labels/links, roles and third-party compiler diagnostics). No generated UI primitives were rewritten.

## Patient CRM development

Apply both migrations using the existing migration command, then rerun the development seed if desired. Migration 001 has not changed. Sign in with your supplied administrator credentials and open `/app/patients`. Search terms remain in POST bodies; patients are addressed by UUID. Receptionists can create/edit; doctors are read-only. Inactive records are retained.

```sh
node --env-file=.env.local --import tsx scripts/migrate.ts
node --env-file=.env.local --import tsx scripts/seed.ts --dry-run
node --env-file=.env.local --import tsx scripts/seed.ts
npm test
npm run test:api
SMOKE_ORIGIN=http://localhost:3000 npm run test:http
npm run build
npm run typecheck
npm run lint
```

Run build and typecheck sequentially because the build regenerates route types. API integration tests execute real handlers and PostgreSQL SQL using PGlite; only the framework session/pool boundary is mocked using Node's experimental module-mock facility (Node 22.13+). Live HTTP tests independently verify session rejection and preservation of public routes. Docker/PostgreSQL network verification remains separate.

Grant the runtime role SELECT/INSERT/UPDATE on patients, patient_counters, lab_test_categories, lab_units, lab_tests, lab_reference_ranges, lab_orders, lab_order_tests, lab_specimens, lab_specimen_tests, lab_results, lab_reports, lab_report_shares, lab_invoices and the yearly counters, retaining existing organization/user/audit privileges. Grant INSERT/SELECT on lab_report_deliveries and lab_invoice_payments. Grant SELECT/INSERT/DELETE on lab_report_share_sessions. Grant SELECT/INSERT/UPDATE on share_access_limits. Grant DELETE only on `lab_order_tests` for draft removal. Do not grant DELETE on `lab_report_shares`, `lab_invoices` or `lab_invoice_payments`. Do not grant DELETE/TRUNCATE on clinical tables or audit UPDATE/DELETE/TRUNCATE. Include those tables in encrypted backups and restore exercises.

## Laboratory catalogue development

Apply migration 003 using the existing migration command, then rerun the development seed if desired. Migrations 001 and 002 have not changed. Sign in with your supplied administrator credentials and open `/app/management/tests`. Search terms remain in POST bodies; tests are addressed by UUID. Biochemists and administrators can create/edit; laboratory technicians and receptionists are read-only. Reference ranges are retired or replaced, never deleted.

```sh
node --env-file=.env.local --import tsx scripts/migrate.ts
node --env-file=.env.local --import tsx scripts/seed.ts --dry-run
node --env-file=.env.local --import tsx scripts/seed.ts
npm test
npm run test:api
SMOKE_ORIGIN=http://localhost:3000 npm run test:http
npm run build
npm run typecheck
npm run lint
```

## Laboratory orders and specimens

Apply migration 004 using the existing migration command, then rerun the development seed if desired. Migrations 001–003 have not changed. Sign in with your supplied administrator credentials and open `/app/laboratory/orders`. Search terms remain in POST bodies; orders and specimens are addressed by UUID. Receptionists can create drafts and place orders. Laboratory technicians and biochemists collect, receive and reject specimens. Administrators may also cancel orders. Status changes use explicit action endpoints, not a generic status PATCH.

```sh
node --env-file=.env.local --import tsx scripts/migrate.ts
node --env-file=.env.local --import tsx scripts/seed.ts --dry-run
node --env-file=.env.local --import tsx scripts/seed.ts
npm test
npm run test:api
SMOKE_ORIGIN=http://localhost:3000 npm run test:http
npm run build
npm run typecheck
npm run lint
```

## Laboratory results

Apply migration 005 using the existing migration command. Migrations 001–004 have not changed. Sign in and open a received order or `/app/laboratory/results`. Laboratory technicians enter and technically validate results. Biochemists also clinically verify and amend. Doctors can read orders and results. Receptionists do not see result values. Status changes use explicit action endpoints.

```sh
node --env-file=.env.local --import tsx scripts/migrate.ts
npm test
npm run test:api
SMOKE_ORIGIN=http://localhost:3000 npm run test:http
npm run build
npm run typecheck
npm run lint
```

## Laboratory reports

Apply migration 006 using the existing migration command. Migrations 001–005 have not changed. Sign in, clinically verify every active test on an order, then issue an official report from the order or open `/app/reports`. Biochemists and administrators generate reports and record delivery. Doctors can download issued PDFs. Report files are generated from frozen snapshots; older versions remain downloadable after amendments.

```sh
node --env-file=.env.local --import tsx scripts/migrate.ts
npm test
npm run test:api
SMOKE_ORIGIN=http://localhost:3000 npm run test:http
npm run build
npm run typecheck
npm run lint
```

## Laboratory report sharing

Apply migration 007 using the existing migration command. Migrations 001–006 have not changed. Sign in as a biochemist or administrator, open an issued report, create a secure share, then open `/report-access/[token]` without a staff session. Recipients enter the one-time PIN and download the official PDF. Doctors can still download issued reports internally but cannot create public links.

```sh
node --env-file=.env.local --import tsx scripts/migrate.ts
npm test
npm run test:api
SMOKE_ORIGIN=http://localhost:3000 npm run test:http
npm run build
npm run typecheck
npm run lint
```

## Laboratory billing

Apply migration 008 using the existing migration command. Migrations 001–007 have not changed. Sign in as a receptionist or administrator, open a laboratory order with active priced tests, create a draft invoice, optionally set discount/tax, issue it, then record payments from the order Billing panel or `/app/billing`. Issued PDFs and list labels use the frozen invoice snapshot. Doctors and technicians cannot access billing.

```sh
node --env-file=.env.local --import tsx scripts/migrate.ts
npm test
npm run test:api
SMOKE_ORIGIN=http://localhost:3000 npm run test:http
npm run build
npm run typecheck
npm run lint
```

## Laboratory billing operations

Apply migration 009 using the existing migration command. Migrations 001–008 have not changed. Sign in as an administrator to reverse a payment, issue a credit note, change organization currency/tax, or download a receipt. Receptionists can still record payments and email the official invoice PDF, but cannot reverse payments, issue credit notes, or change billing defaults. Issued invoice snapshots and original payment rows stay unchanged.

```sh
node --env-file=.env.local --import tsx scripts/migrate.ts
npm test
npm run test:api
SMOKE_ORIGIN=http://localhost:3000 npm run test:http
npm run build
npm run typecheck
npm run lint
```

## Production readiness

Phase 10 does not add clinical or billing features and does not deploy a public domain. Use existing migrations 001–009, production environment validation, and the [operations runbook](docs/operations.md).

```sh
node --env-file=.env.local --import tsx scripts/migrate.ts
npm test
npm run test:api
SMOKE_ORIGIN=http://localhost:3000 npm run test:http
npm run build:node
npm run typecheck
npm run lint
```
