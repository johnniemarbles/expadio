# ADR-011: Persist Social COMMUNICATE intent without dispatch

## Status
**Accepted — freeze exception follow-up 2026-08-31 — social Communication seam**

## Decision
1. After Decision Fabric stage `APPROVED` on work type `social.content_publish`, a reviewer (not the author) may file a Communication intent.
2. The intent uses capability `communication.social.send`, connector `social.linkedin`, provider `linkedin`, channel `social`, recipient `subjectId`.
3. Persist mapping is a `COMMUNICATE` Action Intent via `toGovernedCommunicateIntent` / `persistGovernedActionIntent`. Do **not** call `executeGovernedCommunicateAction` or enqueue a delivery while `social.linkedin` is disabled.
4. Connector dark is a response reason (`CONNECTOR_DISABLED` / `sent: false` / `dispatched: false`), not a reason to skip mapping an already-approved touch.
5. Calendar expands to N slot intents. Never a batch `send()`. Never Action Fabric type `PUBLISH_SOCIAL`.
6. Decision Fabric PR #482 stays HOLD. This ADR does not seed `platform.social_content_items` or the PLATFORM blueprint.

## Consequences
- Filing after APPROVE + SoD returns `sent: false`, `dispatched: false`, `persisted: true`, `reasonKey: CONNECTOR_DISABLED` while the connector is off.
- An HTTP communicate route that loads a subject row waits for an explicit #482 release.
- Enabling `social.linkedin` later is a separate operator step after tenant BYOC + governed lease. ACCEPTED still requires a real provider message id.
