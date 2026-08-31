# ADR-011: Lead capture convert seam

## Status
**Accepted — freeze exception 2026-08-31**

## Context
Inbound demand-capture lives in `johnniemarbles/expadio-lead-management` (19-stage journey).
EXPADIO already owns `platform.crm_leads` and `@expadio/lead` (`NEW / QUALIFIED / PROPOSAL / WON / LOST`).
AutoGTM already ingests as `source=outbound_gtm`. Existing `POST /api/crm/leads/:id/convert` turns a CRM lead into a customer — that funnel must not be overloaded.

## Decision
1. Inbound capture converts through `@expadio/lead.buildCrmLeadFromCapture` + `mapCaptureStageToCrm`.
2. CRM `source` for inbound capture is existing `web_form`. Do not add a second source key.
3. Provenance columns `capture_lead_id` and `capture_layer_id` hang on `platform.crm_leads`. Unique per tenant+capture lead so re-convert is idempotent.
4. Convert does not delete the capture row, submissions, attribution, or audit (I8).
5. Extract packages, lab `apps/api`, and BEMP `/brand/leads` stay out of this PR.
6. Live FORCE RLS soak of extract `0001`+`0002` plus this seam remains a merge gate.
7. Production principal stays the EXPADIO gateway (`resolveRequestContext`). Body `tenantId` / `brandId` / `layerId` are rejected (P16).
8. The write path is `POST /api/crm/leads/from-capture`. It is not `POST /api/crm/leads/:id/convert`.
9. Schema lives in `0087_lead_capture_convert_seam.sql` so social #491 can keep `0086`.

## Consequences
- Capture and CRM catalogues stay separate.
- Re-convert upserts on `(tenant_id, capture_lead_id)` and returns the same CRM row.
- Soak expectations are listed by `platform.lead_capture_soak_expectations()`.
- Lab header trust (`LAB_TRUSTED_HEADERS`) stays off on platform.
