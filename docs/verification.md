# MEDISOFT verification

Validation is performed on the local checkout, with synthetic data only. No live VPS, existing production database, domain or SSL configuration was modified.

## Checks
- Strict TypeScript and application lint.
- Unit/engine tests for organization validation, permission grants, session tokens, password verification, live session expiry and account disabling, two-organization isolation, composite foreign keys, append-only audit events, transactional login/logout and audit-failure rollback, account throttling (failures only; successful login resets the counter), dashboard and application shell.
- Patient CRM tests for validation, create/update, duplicates, tenant isolation, permissions and audit.
- Laboratory catalogue tests for create/read/update/deactivate, search and category filtering, duplicate codes, reference-range create/replace/retire, immutable historical bounds, invalid ages/bounds/dates, tenant isolation, permissions and audit.
- Laboratory order and specimen tests for draft/place, catalogue snapshots, derived collection progress, specimen–test linking, compatibility, rejection with replacement, cancellation, RBAC and cross-tenant 404s. Order APIs deny unauthenticated access and do not expose clinical DELETE.
- Laboratory result tests for ordered-test ownership, result-time snapshots, deterministic flags, `IN_PROCESS`, technical validation, clinical verification, amendments, RBAC and cross-tenant 404s. Result APIs deny unauthenticated access and do not expose clinical DELETE.
- Laboratory report tests for order completion/reopening, report eligibility, immutable snapshots, versioning, PDF download, delivery records, RBAC and cross-tenant 404s. Report APIs deny unauthenticated access and do not expose clinical DELETE.
- HTTP checks against Next.js for all protected module URLs, public English/Albanian pages and demos, forged session cookie rejection, origin validation, invalid input and bounded request bodies. Catalogue, order, result and report pages/APIs deny unauthenticated access and do not expose hard deletion of clinical records.
- Standard Next.js production build.

PGlite exercises PostgreSQL SQL semantics in-process. It does not verify a remote PostgreSQL connection, container networking, resource usage under concurrent load, or production proxy configuration. Docker's daemon is not running in this environment, so container startup has not been verified. These deployment checks remain required before customer rollout.

The original Sites toolchain has npm audit findings in Vinext/image-size, Vite and Cloudflare/Wrangler dependencies. It is retained without an unrequested migration of the live marketing deployment. The new application uses standard Next.js, including its patched Sharp dependency. React, React DOM and React Server Components are updated together to 19.2.8. Do not expose the legacy development tools publicly; review/update them before any future Sites deployment.

No real patient records, billing, invitations, password recovery or clinical AI are implemented. Result entry, technical validation, clinical verification, amendments, order completion and laboratory reports are implemented for development use; this is not a declaration of clinical production readiness.

## Local results

Recorded after Phase 4 against PostgreSQL 17 and PGlite. Re-run the commands below on the current checkout.

```sh
npm run lint
npm run typecheck
npm test
npm run test:api
npm run build:node
SMOKE_ORIGIN=http://localhost:3000 npm run test:http
```

PGlite covers application SQL and handlers. Real PostgreSQL 17 verification applies `006_lab_reports.sql` through `scripts/migrate.ts`, confirms idempotent re-runs, and exercises order completion, report issuance, snapshot immutability, PDF download and delivery recording on the saved development database.

The Sites/Vinext toolchain is unchanged and still carries dependency advisories. It is not the supported PostgreSQL application runtime.
