# ADR-008: AutoGTM platform slice

## Status
**Accepted — freeze exception 2026-08-31 — expadio#483**

## Context
Explee-like demand generation (website → ICP → prospects → sequences → send/replies → meetings → optimize) is a native EXPADIO capability named **Demand Generation Control Plane** (product: AutoGTM). Engines live in `johnniemarbles/expadio-demand-generation`. This slice registers the platform seams only.

## Decision
1. Map lab `gtm_*` tables onto `platform.gtm_*` with forced RLS.
2. Seed four PLATFORM Decision Fabric work types:
   - `gtm.icp.publish`
   - `gtm.sequence.publish`
   - `gtm.campaign.launch`
   - `gtm.meeting_request`
3. Review stages require a participant and APPROVE/REJECT. `autoAdvance` is false. No auto-approve.
4. Seed connector `gtm.email` **DISABLED**, bound to existing capability `communication.email.send` (provider `resend`). Lab adapter `gtm-email-lab-v1` is forbidden on platform.
5. Do not add Action Fabric type `SEND_OUTBOUND`.
6. Warm replies ingest as `platform.crm_leads` with `source = outbound_gtm` and `raw_payload` first. Not a second CRM.
7. Extract `apps/*` stay out of this merge.

## Consequences
- Review queue can resolve the four GTM work types via `SUBJECT_TABLES`.
- Send remains Communication-owned and stays dark until a tenant binds BYOC and enables `gtm.email`.
- Engine packages merge later; this slice is the governed skeleton.
