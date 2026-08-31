# ADR-010: Persist AutoGTM COMMUNICATE intent without dispatch

## Status
**Accepted — freeze exception follow-up 2026-08-31 — expadio#483**

## Decision
1. After DF `APPROVED` + SoD, persist a `COMMUNICATE` Action Intent via `persistGovernedActionIntent`.
2. Do **not** call `executeGovernedCommunicateAction` or enqueue a delivery while `gtm.email` is disabled.
3. Connector dark is a response reason (`CONNECTOR_DISABLED`), not a reason to skip persistence of an already-approved touch.
4. No `SEND_OUTBOUND`. No lab adapter.

## Consequences
- Seed-tenant communicate returns `sent: false`, `dispatched: false`, `persisted: true`.
- Enabling `gtm.email` later is a separate, explicit operator step after BYOC + sender identity.
