# Laboratory report sharing — Phase 7

Phase 7 adds secure, expiring, revocable patient/recipient access to **already issued** laboratory reports. Clinical verification, order completion, report generation, versioning and snapshot semantics from Phase 6 are unchanged.

The workflow is: official report issued → authorized staff create a secure share → recipient opens `/report-access/[token]` → PIN verification → official PDF download from the frozen snapshot → access is audited → the link expires or is revoked.

## Share model

`007_report_sharing.sql` adds `lab_report_shares`, `lab_report_share_sessions` and `share_access_limits`. Migrations 001–006 are unchanged.

Shares are organization-scoped and point at one immutable `lab_reports` row through a composite foreign key. Status is derived:

- `REVOKED` when `revoked_at` is set
- `EXPIRED` when `expires_at` is in the past
- otherwise `ACTIVE`

There is no status column and no hard DELETE. Identity fields (token digest, PIN hash, report binding, recipients, purpose, created-by) cannot be updated. Revocation is one-way. Sessions for a revoked share are deleted so existing cookies stop working; every public request also re-checks share status.

Expiry options are 24 hours, 3 days, 7 days and 30 days. Permanent public links are not created.

## Tokens and PIN

The URL token is 32 random bytes encoded as 64 hex characters (`crypto.randomBytes`). Only a SHA-256 hex digest is stored. A leaked database does not yield usable links. Comparison uses the stored digest lookup plus constant-time password verification for the PIN (`timingSafeEqual` via scrypt).

The access PIN is an 8-digit numeric value created with `crypto.randomInt`. It is stored with the same salted scrypt hasher as passwords. Staff can copy the PIN once at creation. The PIN is never placed in the URL, never logged, and never returned from list/revoke APIs.

After a correct PIN, an HttpOnly `medisoft_share` cookie is issued. The session is scoped to that share, lasts at most two hours (or until the share expires, whichever is sooner), and is useless after revocation or expiry.

Unknown, expired, revoked and malformed tokens all use one public message:

`This report link is unavailable. It may have expired or been revoked.`

Wrong PIN on an otherwise valid active share returns a distinct incorrect-PIN message. Failed PIN and PDF attempts are rate-limited (5 PIN failures / 15 minutes per token digest; 30 PDF attempts / 15 minutes).

## Eligibility and versions

Only issued official reports may be shared (`ISSUED` or `SUPERSEDED`). Creating a share does not issue a report and does not change order status. A share for R1 always resolves to R1. Later issuance of R2 does not redirect or rewrite R1 links. Existing valid links to superseded reports remain usable until they expire or are revoked.

## Public access

- `GET /report-access/[token]` — patient-facing page, no staff session
- `POST /api/public/reports/[token]/verify` — PIN verification, sets the share cookie
- `GET /api/public/reports/[token]/pdf` — snapshot-only official PDF

The page shows laboratory identity, report number/version, issued date, frozen patient name and order number, plus a PDF download. Clinical values are not reconstructed from live tables. `clinicalReportFromSnapshot()` remains the only official clinical document builder; public PDFs call the existing Phase 6 renderer.

Pages and PDFs send `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and `X-Robots-Tag: noindex, nofollow`. Public PDF and JSON endpoints also send `Cache-Control: private, no-store`. Next.js HTML document responses for `/report-access/*` currently emit `Cache-Control: no-cache, must-revalidate` (still not publicly reusable without revalidation). `/robots.txt` disallows `/report-access/` and `/api/public/`. Production links must be served over HTTPS (`APP_ORIGIN`).

## Staff UI and copy-out

There is no mailer in this repository. Staff copy the secure link, PIN and an optional patient message instead of sending email. Email can be added later without changing the share model; the PDF must not be attached by default.

Authorized users (Biochemist and administrators) can create and revoke shares from each report-history row. Doctors may read/download issued reports but cannot create public shares. Technicians, receptionists and viewers cannot share.

## Permissions

- `reports:share`
- `reports:share-revoke`

Server routes enforce these independently of UI visibility.

## Audit

`audit_events` records `LAB_REPORT_SHARE_CREATED`, `LAB_REPORT_SHARE_REVOKED`, `LAB_REPORT_SHARE_VERIFIED`, `LAB_REPORT_SHARE_ACCESSED` and `LAB_REPORT_SHARE_DOWNLOAD`. Metadata may include report/share identifiers, report number/version, recipient descriptor and expiry. Raw tokens, PINs and invasive request telemetry are not stored.

## Proxy recommendation

Application rate limits are per token digest, not per IP. Place an IP request limit on `/report-access/*` and `/api/public/*` at Caddy or the TLS terminator before internet exposure.

## Out of scope

Patient accounts/portals, SMTP, SMS/WhatsApp, QR/PKI, permanent public URLs, HL7/FHIR, and any change to Phase 6 snapshot or PDF architecture. Laboratory invoicing is implemented separately in Phase 8; see [lab-billing.md](lab-billing.md).
