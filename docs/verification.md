# Phase 1 verification

Validation is performed on the local checkout, with synthetic data only. No live VPS, existing production database, domain or SSL configuration was modified.

## Checks
- Strict TypeScript and application lint.
- Unit/engine tests for organization validation, permission grants, session tokens, password verification, live session expiry and account disabling, two-organization isolation, composite foreign keys, append-only audit events, transactional login/logout and audit-failure rollback, account throttling, dashboard and application shell.
- HTTP checks against Next.js for all protected module URLs, public English/Albanian pages and demos, forged session cookie rejection, origin validation, invalid input and bounded request bodies.
- Standard Next.js production build.
- Docker Compose syntax validation with nonsecret temporary values.

PGlite exercises PostgreSQL SQL semantics in-process. It does not verify a remote PostgreSQL connection, container networking, resource usage under concurrent load, or production proxy configuration. Docker's daemon is not running in this environment, so container startup has not been verified. These deployment checks remain required before customer rollout.

The original Sites toolchain has npm audit findings in Vinext/image-size, Vite and Cloudflare/Wrangler dependencies. It is retained without an unrequested migration of the live marketing deployment. The new application uses standard Next.js, including its patched Sharp dependency. React, React DOM and React Server Components are updated together to 19.2.8. Do not expose the legacy development tools publicly; review/update them before any future Sites deployment.

No real patient records, clinical workflows, AI calls, user invitations or password recovery are implemented. This is a tested development foundation, not a declaration of clinical production readiness.

## Local results (2026-09-10)

- `npm run build`: passed; 26 static pages generated and authenticated routes remain dynamic.
- `npm run lint`: passed.
- `npm run typecheck`: passed. Run after the build rather than concurrently, because Next regenerates route types.
- `npm test`: 13 tests passed.
- `SMOKE_ORIGIN=http://localhost:3000 npm run test:http`: 3 HTTP suites passed.
- `docker compose config --quiet`: passed with temporary validation values.
- `git diff --check`: passed.

The source backup before implementation is `/private/tmp/medisoft-phase1-before.tar.gz`. Changes are local and uncommitted; no GitHub push or deployment was performed.
