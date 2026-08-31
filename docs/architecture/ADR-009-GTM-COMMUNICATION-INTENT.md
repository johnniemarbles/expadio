# ADR-009: AutoGTM files a Communication intent after APPROVE

## Status
**Accepted — 2026-08-31 — follows ADR-008 / expadio#483**

## Context
The platform slice seeded connector `gtm.email` DISABLED. Send must stay Communication-owned. Extract engines stay out of this merge.

## Decision
1. After Decision Fabric stage `APPROVED` on `gtm.sequence.publish`, a reviewer (not the author) may file a Communication intent.
2. The intent uses capability `communication.email.send`, connector `gtm.email`, provider `resend`.
3. If `gtm.email` is missing or disabled the route returns `CONNECTOR_DISABLED` and `sent: false`. No provider call.
4. Lab adapter `gtm-email-lab-v1` and Action Fabric type `SEND_OUTBOUND` remain forbidden.
5. Warm replies (`interested`, `meeting_requested`) ingest as `platform.crm_leads` with `source = outbound_gtm` and `raw_payload` first.

## Consequences
- COMMUNICATE is proven as a dark intent on the seed tenant.
- Enabling send is a later tenant BYOC + sender-identity change, not a code flip in this slice.
- Extract `gtm-*` engines still merge only after a tenant-bound enabled connector is proven.
