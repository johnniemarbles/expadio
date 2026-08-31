# Social Communication wiring (EXPADIO)

**Status:** freeze-exception slice on `feat/social-communication-wiring-0086`. Connector is **disabled**.  
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

Recipient addressing uses `subjectId` (LinkedIn person id or `urn:li:person:…`). Social is **not** a sender-identity channel: do not add it to `CommunicationSenderChannel` or `communication_sender_identities`.

After Decision Fabric `APPROVED`, file a Communication intent / `COMMUNICATE` action. Author cannot file that intent (SoD). Calendar expands to N intents — never a batch `send()` and never a new executor.

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
