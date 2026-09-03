# Social Communication wiring (EXPADIO)

**Status:** freeze-exception Communication seam on main wiring + ADR-011. Connector is **disabled**.  
**Lab contract:** `expadio-social-content` 0.6.2 `docs/architecture/COMMUNICATION-ADAPTER-REGISTRATION.md`.  
**Binding ADR:** lab ADR-007 — social send is a Communication connector, not `PUBLISH_SOCIAL`.  
**Intent ADR:** `ADR-011-SOCIAL-PERSIST-COMMUNICATE-INTENT.md`.

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

After Decision Fabric `APPROVED`, a reviewer files a Communication intent / `COMMUNICATE` action (`apps/platform-web/lib/social-communication.ts`). Author cannot file that intent (SoD). While `social.linkedin` is disabled the file result is `sent: false`, `dispatched: false`, `reasonKey: CONNECTOR_DISABLED`. Calendar expands to N intents — never a batch `send()` and never a new executor.

## Explicitly not done here

- Enabling `social.linkedin`
- Wiring the delivery worker to LinkedIn (Resend remains the only production execution path)
- Merging Decision Fabric PR #482 or seeding `platform.social_content_items`
- HTTP `/api/social-content/:id/communicate` (needs the #482 subject table)
- Seeding Meta / X / Threads / IG / TikTok / YouTube / Bluesky / Pinterest / GBP connectors
- Adding social to the Communications provider onboarding modal catalog
- Claiming COMMUNICATE → provider attempt → trace is proven for social

## Enablement gate

1. COMMUNICATE → `communication_provider_attempts` → trace is proven on main for email.
2. Tenant BYOC credential + governed lease for `social.linkedin`.
3. Explicit operator enable of the connector.
4. Worker dispatch only after (1)–(3). ACCEPTED still requires a real provider message id (`x-restli-id`).
