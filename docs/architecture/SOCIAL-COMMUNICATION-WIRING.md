# Social Communication wiring (EXPADIO)

**Status:** dark wiring on `main` via #491 (`0086_communication_social_channel.sql`). Connector is **disabled**. Seed-tenant catalog proof is the SQL smoke `infra/db/tests/social_linkedin_connector_smoke.sql`.  
**Lab contract:** `expadio-social-content` 0.6.2 `docs/architecture/COMMUNICATION-ADAPTER-REGISTRATION.md`.  
**Binding ADR:** lab ADR-007 — social send is a Communication connector, not `PUBLISH_SOCIAL`.

## What this slice registers

| Field | Value |
|-------|--------|
| `channel` | `social` |
| capability | `communication.social.send` |
| connector | `social.linkedin` (PLATFORM, **enabled = false**) |
| provider | `linkedin` |
| adapter | `linkedin-social-text-v1` |
| lease purpose | `communication.social.send:{purpose}` |
| migration | `0086_communication_social_channel.sql` |
| addressKind | `subject` |
| requiresConsent | `true` |
| supportsSuppression | `false` (revoke the connector; do not use a bounce list) |

Recipient addressing uses `subjectId` (LinkedIn person id or `urn:li:person:…`). Social is **not** a sender-identity channel: do not add it to `CommunicationSenderChannel` or `communication_sender_identities`.

After Decision Fabric `APPROVED`, file a Communication intent / `COMMUNICATE` action. Author cannot file that intent (SoD). Calendar expands to N intents — never a batch `send()` and never a new executor.

## Seed-tenant proof (catalog)

After migrations, a seed tenant can observe:

1. `platform.capabilities.capability_key = communication.social.send` exists and is enabled as vocabulary.
2. `platform.connectors.connector_key = social.linkedin` exists with `enabled = false`, `ownership_scope = PLATFORM`, `tenant_id` NULL, `provider_type = social`, `provider_key = linkedin`.
3. `platform.connector_capabilities` binds that connector to that capability exactly once.
4. `communication_deliveries.channel` CHECK includes `social`.
5. `communication_sender_identities.channel` CHECK rejects `social`.

This is not COMMUNICATE proof and not a live send.

## Explicitly not done here

- Enabling `social.linkedin`
- Wiring the delivery worker to LinkedIn (Resend remains the only production execution path)
- Merging Decision Fabric PR #482
- Seeding Meta / X / Threads / IG / TikTok / YouTube / Bluesky / Pinterest / GBP connectors
- Adding social to the Communications provider onboarding modal catalog
- Claiming COMMUNICATE → provider attempt → trace is proven for social

## Enablement gate

1. COMMUNICATE → `communication_provider_attempts` → trace is proven on main for email.
2. Tenant BYOC credential + governed lease for `social.linkedin`.
3. Explicit operator enable of the connector.
4. Worker dispatch only after (1)–(3). ACCEPTED still requires a real provider message id (`x-restli-id`).
