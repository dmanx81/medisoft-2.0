# Laboratory reports — Phase 6

Phase 6 adds server-side order completion, issued laboratory reports with immutable snapshots, on-demand PDF generation, report version history and a minimal delivery record. Billing, patient portals, HL7/FHIR, analyzers, SMS and digital signatures remain out of scope.

## Completion

`COMPLETED` is current clinical completeness, not a terminal immutable state.

An order becomes `COMPLETED` when it has at least one `ACTIVE` ordered test and every `ACTIVE` ordered test has a **current** `CLINICALLY_VERIFIED` result. Cancelled ordered tests are ignored. Superseded (`is_current=false`) rows are ignored.

Completion is evaluated only on the server, after clinical verification and after amendment, inside the same transaction as the result change. Generating a PDF or report never sets completion.

If a verified current result is amended, the new current row returns to `ENTERED` and a previously `COMPLETED` order returns to `IN_PROCESS` (`LAB_ORDER_REOPENED`). After the amendment is validated and verified, and every active test is again clinically verified, the order returns to `COMPLETED`.

`IN_PROCESS` and `COMPLETED` are sticky against specimen-coverage derivation.

## Reports

`006_lab_reports.sql` adds `lab_reports` and `lab_report_deliveries`. Migrations 001–005 are unchanged.

A report belongs to an organization, laboratory order and patient. Report numbers reuse the order number plus a monotonic version: `LAB-YYYY-NNNNNN-R{version}`. Version 1 has no predecessor; later versions set `supersedes_id`. The previous current row is marked `SUPERSEDED` and `is_current=false`. Issued reports cannot be deleted. Clinical snapshot, report number, version, patient, order, issuer and issued timestamp are immutable.

An official report may be generated only when the order is clinically complete. A second version is allowed only when current verified result identities differ from the frozen snapshot (typically after amendment and re-verification). Duplicate generation of the same verified results returns `REPORT_ALREADY_CURRENT`.

## Snapshot and PDF

At issuance the server freezes organization identity/contact fields that already exist, patient demographics that already exist, order/specimen identifiers, and each current clinically verified result (value, unit, method, frozen range display, flag, verification metadata, amendment marker). Later patient, catalogue, reference-range, organization or result changes do not rewrite issued snapshots.

PDFs are generated on demand from that snapshot with `pdfkit`. No object-storage path is exposed. `GET /api/lab-reports/:id/pdf` is authenticated, organization-scoped and returns `application/pdf`.

## Delivery

Phase 6 records `DOWNLOAD`, `PRINT` or `MANUAL` delivery against an issued report. Email/SMS infrastructure is not added. Delivery rows are append-only.

## Permissions

- `reports:read` — BIOCHEMIST, DOCTOR, administrators
- `reports:download` — same as read
- `reports:generate` / `reports:deliver` — BIOCHEMIST and administrators

Doctors may view and download issued reports. They cannot issue reports or record delivery. Laboratory technicians and receptionists do not receive report permissions.

## APIs

- `GET /api/lab-orders/:id/report-context`
- `GET|POST /api/lab-orders/:id/reports`
- `POST /api/lab-reports/search`
- `GET /api/lab-reports/:id`
- `GET /api/lab-reports/:id/pdf`
- `POST /api/lab-reports/:id/deliver`
- `DELETE` on report collections returns 405

Organization IDs, eligibility flags and version numbers from the browser are not trusted. Cross-tenant identifiers return 404.

## Audit

`LAB_ORDER_COMPLETED`, `LAB_ORDER_REOPENED`, `LAB_REPORT_GENERATED`, `LAB_REPORT_SUPERSEDED`, `LAB_REPORT_DOWNLOADED` and `LAB_REPORT_DELIVERED` are written to existing `audit_events`.

## UI

Completed orders show a completion badge. Authorized users can issue a report, download historical PDFs, see version/current markers and record delivery. After an amendment the order shows that a newer official report is required once results are re-verified. `/app/reports` lists issued reports for the organization.

## Known limitations

No HL7/FHIR, analyzer import, patient portal, public report links, email/SMS sending, e-signature/PKI, QR verification, billing, inventory, QC or AI interpretation.
