# MEDISOFT operations runbook — Phase 10

This runbook prepares a real production deployment. It does **not** change DNS, issue certificates for a public hostname, or deploy to a live domain. Clinical, report, share and billing behavior from Phases 1–9 is unchanged.

## Prerequisites

- Node.js 22.13+
- PostgreSQL 17
- `pg_dump` / `pg_restore` on the operator host
- An HTTPS reverse proxy that already terminates TLS (nginx, Caddy, or equivalent)
- Separate **migration-owner** and **runtime** database roles
- SMTP credentials if invoice email will be enabled; otherwise set `EMAIL_PROVIDER=disabled`

Standard Next.js on Node is the supported runtime (`npm run build:node` / `npm run start:node` or the Docker image). Vinext/Sites scripts are deployment history only and cannot use this application's PostgreSQL connection.

## Required environment variables

Copy `.env.example`. Never commit real values.

| Variable | Production requirement |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | PostgreSQL URL with a non-placeholder password. Runtime should use a limited role. Localhost is allowed for a same-host VPS database; do not expose PostgreSQL publicly. |
| `APP_ORIGIN` | Exact public HTTPS origin, no path or trailing slash. Localhost, `.local` and HTTP are rejected. |
| `DASHBOARD_DEMO` | Must be `false` |
| `EMAIL_PROVIDER` | `smtp` or `disabled`. `stub` is rejected. |
| `SMTP_FROM` | Required when `EMAIL_PROVIDER=smtp` |
| `SMTP_URL` or `SMTP_HOST` | Required when `EMAIL_PROVIDER=smtp`. Localhost SMTP is rejected. |
| `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASSWORD` | As required by the mail server |
| `LOG_LEVEL` | Optional; defaults to `info` |
| `BACKUP_DIR` | Required for `npm run db:backup` |
| `BACKUP_FILE` / `CONFIRM_RESTORE` | Restore only |

There is **no JWT or session HMAC secret**. Sessions are opaque 64-hex tokens; only SHA-256 digests are stored in `sessions`. Production sets the `Secure` cookie flag because `NODE_ENV=production`. SameSite is `Lax`. Cookies are `HttpOnly`.

This application does not use Supabase, S3, or an upload directory. Do not set unused vendor variables.

Validate without printing secrets:

```sh
NODE_ENV=production node --env-file=.env.production --import tsx scripts/check-config.ts
```

Application startup (`instrumentation.ts`) runs the same validation in the Node server. `next build` skips it so a local production build can complete.

## Secret generation

Generate a database password and SMTP password with a cryptographic generator. Do not reuse `replace-with-local-password`, `medisoft_local_dev`, `secret`, `password`, or other values listed as placeholders in `lib/env.ts`. Seed credentials (`SEED_ADMIN_*`) are development-only; `scripts/seed.ts` refuses to run when `NODE_ENV=production`.

## PostgreSQL creation

Create an empty database and two roles. Example (no real passwords):

```sql
CREATE ROLE medisoft_owner LOGIN PASSWORD 'owner-password-here';
CREATE ROLE medisoft_runtime LOGIN PASSWORD 'runtime-password-here';
CREATE DATABASE medisoft OWNER medisoft_owner;
```

Runtime grants after migrations:

```sql
GRANT CONNECT ON DATABASE medisoft TO medisoft_runtime;
GRANT USAGE ON SCHEMA public TO medisoft_runtime;
GRANT SELECT, INSERT, UPDATE ON
  organizations, users, login_limits, patients, patient_counters,
  lab_test_categories, lab_units, lab_tests, lab_reference_ranges,
  lab_orders, lab_order_tests, lab_specimens, lab_specimen_tests,
  lab_order_counters, lab_accession_counters, lab_results, lab_reports,
  lab_report_shares, share_access_limits, lab_invoices, lab_invoice_counters,
  lab_credit_notes, lab_credit_note_counters
  TO medisoft_runtime;
GRANT SELECT, INSERT, DELETE ON sessions, lab_report_share_sessions TO medisoft_runtime;
GRANT INSERT, SELECT ON
  audit_events, lab_report_deliveries, lab_invoice_payments,
  lab_invoice_payment_reversals, lab_invoice_deliveries
  TO medisoft_runtime;
GRANT DELETE ON lab_order_tests TO medisoft_runtime;
```

Do not grant DDL, table ownership, `TRUNCATE`, or `UPDATE`/`DELETE` on audit or append-only financial/share tables.

## Migration execution

Migrations never run on application startup. Apply them explicitly with the owner URL:

```sh
DATABASE_URL=postgresql://medisoft_owner:OWNER_PASSWORD@db-host/medisoft npm run db:migrate
```

The runner records SHA-256 checksums in `schema_migrations` and is a no-op when files are unchanged. Do not edit migrations `001`–`009`. Re-running after a successful apply must print nothing new.

Startup order: empty PostgreSQL → migrate → runtime grants → start the Node server.

## Persistent storage

Durable state is **PostgreSQL only**.

- Invoice, receipt and laboratory-report PDFs are generated in memory from frozen snapshots (`pdfkit`, `compress: false`). They are not written to disk.
- There is no `UPLOAD_DIR` and no user file upload path.
- Temporary PDF bytes live in the request; they do not need a persistent volume on the application container.
- The Compose named volume `medisoft_data` is the PostgreSQL data directory. Never delete it during an application upgrade.
- The application image/container layer is ephemeral. Do not place backups inside it.

Operator backups belong on a host directory or volume, for example `BACKUP_DIR=/var/backups/medisoft` (mode `2700`, owned by the backup operator).

## Email configuration

`EMAIL_PROVIDER=disabled` — invoice email returns `503 EMAIL_DISABLED`. No delivery row is written.

`EMAIL_PROVIDER=smtp` — sends through nodemailer using `SMTP_URL` or host/port/user/password. The attachment is the official snapshot PDF. Delivery history and `LAB_INVOICE_EMAILED` are recorded only after the provider reports success. SMTP failures return `503 EMAIL_UNAVAILABLE` without leaking the mail server response.

`stub` is the development/test default and is forbidden in production so a successful response cannot pretend a message was sent.

Sending remains manual (staff action). There is no queue, reminder, or dunning.

## Build and start

```sh
npm ci
NODE_ENV=production npm run build:node
NODE_ENV=production npm run start:node
```

Docker:

```sh
docker compose config --quiet
# Start db, migrate with the owner URL against the published localhost port, then:
docker compose up -d --build app
```

`Dockerfile` uses `node server.js` from Next.js standalone output, `USER node`, `HOSTNAME=0.0.0.0`, `PORT=3000`. It does not copy migrations. Compose binds `127.0.0.1:3000` and `127.0.0.1:5432`. Secrets come from the environment, not the image.

Next.js standalone handles `SIGTERM`. Give the process a few seconds to drain.

## Reverse proxy and HTTPS

- Terminate TLS at the existing proxy. Do not change DNS in this phase.
- Set `APP_ORIGIN` to the exact public origin the browser will send as `Origin` (scheme + host + port if non-default).
- Forward to `http://127.0.0.1:3000`.
- Do not enable a global `Host` trust bypass; login redirects use `APP_ORIGIN`, not the request Host header.
- Overwrite `X-Forwarded-Proto` and `X-Forwarded-Host` so they reconstruct `APP_ORIGIN` exactly. Login, logout, and same-origin mutations accept that exact `Origin`, or literal `Origin: null` only with `Sec-Fetch-Site: same-origin` and a matching reconstructed origin. Redirects still use `APP_ORIGIN`.
- Add a perimeter request-size and IP rate limit before public rollout. Application-level login throttling is 5 failures / 15 minutes per email hash. Report-share PIN attempts are 5 / 15 minutes; public PDF downloads are 30 / 15 minutes.
- HSTS is added by `proxy.ts` only when `NODE_ENV=production` and `APP_ORIGIN` is HTTPS. It is not baked into the production build, so local HTTP development is not forced onto HTTPS.

## Health and readiness

- `GET`/`HEAD /api/health` — process liveness, no database. Body: `{"status":"ok"}`.
- `GET`/`HEAD /api/ready` — `SELECT 1`. `200 {"status":"ready"}` or `503 {"status":"not_ready"}`.

Neither endpoint requires a session or returns secrets. Compose and the Docker image use `/api/ready`. Example:

```sh
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/ready
```

## Query and index review

EXPLAIN on the development PostgreSQL 17 database (synthetic data) used existing tenant indexes. No migration `010_production_readiness.sql` was added.

| Query | Plan |
| --- | --- |
| Patient search by organization + name ILIKE | `Index Scan` on `patients_name`; ILIKE `%term%` remains a filter |
| Order list by `updated_at` | `Index Only Scan` on `lab_orders_updated` |
| Specimens for tenant orders | `Index Scan` on `lab_specimens_order` |
| Verified results | `Index Scan` on `lab_results_status` |
| Report list by `issued_at` | `Index Only Scan` on `lab_reports_issued` |
| Report shares | `Index Scan` on `lab_report_shares_report` |
| Invoice list | `Index Scan` on `lab_invoices_status` plus a small sort on `COALESCE(issued_at, created_at)` |
| Payments / reversals / credit notes | Existing invoice-scoped indexes |
| Audit by organization | Sequential scan on a 6-row development table; `audit_organization_time` already exists for production volume |
| User by email + session by hash | Unique/primary key lookups |

Leading-wildcard `ILIKE` search is organization-scoped by design. Trigram indexes were not added (PGlite fixtures would not match, and the development table is tiny).

## Backup

Custom-format `pg_dump` (compressed) with timestamped names. Passwords stay in the environment, not the command line.

```sh
BACKUP_DIR=/var/backups/medisoft \
DATABASE_URL=postgresql://medisoft_owner:OWNER_PASSWORD@127.0.0.1:5432/medisoft \
npm run db:backup
```

The script writes `medisoft-<ISO-stamp>.dump` and refuses an empty file. Confirm the file exists and has a non-zero size. Encrypt backups at rest on the host; that is an operator concern, not an application feature.

Expired session cleanup (optional maintenance, not a backup step):

```sql
DELETE FROM sessions WHERE expires_at < now();
DELETE FROM lab_report_share_sessions WHERE expires_at < now();
```

## Restore

Restores are destructive and never automatic.

1. Create a **new** empty database (do not restore onto the live development or production database in place without a planned outage).
2. Restore:

```sh
CONFIRM_RESTORE=YES \
BACKUP_FILE=/var/backups/medisoft/medisoft-stamp.dump \
DATABASE_URL=postgresql://medisoft_owner:OWNER_PASSWORD@127.0.0.1:5432/medisoft_restore \
npm run db:restore
```

3. Run `npm run db:migrate` against the restored database (no-op if the dump already contains `schema_migrations`).
4. Re-apply runtime grants.
5. Point a staging `DATABASE_URL` at the restored database, start the app, and check `/api/ready`.

`CONFIRM_RESTORE` must be exactly `YES`.

## Application upgrade

1. Backup the live database.
2. Build the new image/artifact.
3. Apply **new** migrations with the owner role (none in Phase 10 unless `010_production_readiness.sql` exists).
4. Restart the application (`node server.js` / Compose `app`).
5. Check `/api/health` and `/api/ready`.
6. Smoke-test login, a patient, an order and an invoice PDF.

Roll back by restoring the pre-upgrade backup onto a replacement database and starting the previous image. Do not reverse applied SQL by editing migration files. Applied checksums must match the files in the tree.

## Logging

JSON lines to stdout/stderr: `ts`, `level`, `message`, allowlisted context. `lib/log.ts` redacts passwords, tokens, cookies, `DATABASE_URL` and SMTP URLs. Unexpected handler failures log an area name only, not SQL or request bodies. `instrumentation.ts` `onRequestError` logs error name, digest, method, path and `x-request-id`.

Inspect with `docker compose logs -f app` or the process manager journal. Never grep logs for raw session cookies or PINs; those values are not written.

## Common diagnostics

| Symptom | Check |
| --- | --- |
| Process exits at start | `scripts/check-config.ts`; production `APP_ORIGIN` must be HTTPS and not localhost |
| `/api/ready` is 503 | PostgreSQL connectivity and runtime grants; the JSON body never includes the driver error |
| Login or mutation 403 | Exact `Origin` must equal `APP_ORIGIN`, or literal `Origin: null` with `Sec-Fetch-Site: same-origin` and forwarded proto/host reconstructing `APP_ORIGIN` |
| Login 503 | Database down or configuration invalid; generic body only |
| Invoice email 503 `EMAIL_DISABLED` | Set `EMAIL_PROVIDER=smtp` with valid SMTP settings, or keep disabled and use another delivery method |
| Invoice email 503 `EMAIL_UNAVAILABLE` | SMTP host/credentials; no secret is returned |
| Session missing after HTTPS deploy | Proxy TLS and `Secure` cookies; `NODE_ENV` must be `production` only behind HTTPS |

## Post-deployment smoke test

Use a non-production dataset or an empty tenant.

1. `GET /api/health` and `GET /api/ready`
2. Public `/en` and `/login` load
3. Login as an administrator; confirm `Set-Cookie` is `HttpOnly` and `Secure` on HTTPS
4. Open `/app/patients` and `/app/billing`
5. Logout; `/app` redirects to `/login`
6. Cross-origin `POST /api/auth/login` returns 403

## Release checklist (for a later public-domain phase)

- [ ] Production `.env` validated (`config:check`) with a real HTTPS origin
- [ ] PostgreSQL created; migrations 001–009 applied twice (second no-op)
- [ ] Runtime grants applied; owner credentials not used by the app
- [ ] Encrypted backup restored onto a disposable database and `/api/ready` succeeded
- [ ] SMTP proven with a real mailbox, or `EMAIL_PROVIDER=disabled` accepted operationally
- [ ] Reverse proxy TLS, HSTS, and perimeter rate limits
- [ ] MFA, invitations and password recovery still deferred — decide before customer onboarding
- [ ] DNS and public hostname **not** in scope for Phase 10
