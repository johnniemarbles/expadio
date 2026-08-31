# Platform PII proof — draft status

Keep #499 draft. This is a contract and source scan, not authenticated e2e.

## Landed on this tip

- `classifyRequestPath` splits platform-product, brand, lab.
- Product APIs `/api/overview`, `/api/context`, `/api/workspaces`, `/api/journey-correlation` return `Cache-Control: private, no-store`.
- Those routes no longer echo `error.message`.
- `/api/overview` and `/api/context` run `assertPlatformProductPayload` before JSON leaves. A customer-field token fails closed with the generic error body.
- `platformSafeLogLine` redacts email/phone and refuses leftover customer-field tokens. Deployed log capture is still unproven.
- `/api/workspaces` is locked to `SHELL_PLATFORM_SECTIONS`.
- Brand CS-104 GET `/brand/api/journey` authorizes T/B/L + membership, then reads intents + latest attempt + `communication_deliveries.state` for COMMUNICATE. No configuration/metadata/snapshot/recipient columns.
- `delivered` is only claimed when provider state is `DELIVERED`.
- Platform `/api/journey-correlation` does not query executor or delivery tables.
- POST `/brand/api/journey` stays 405.

## Still open

- Runtime proof of logs and caches on a deployed preview.
- Authenticated browser e2e and revoked-session checks.
- A live CS-104 row that actually has provider `DELIVERED` in this tenant.
