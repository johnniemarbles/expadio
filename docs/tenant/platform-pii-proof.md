# Platform PII proof — draft status

Keep #499 draft. This is a contract and source scan, not authenticated e2e.

Deploy target: Railway is the initial hosting provider. Runtime log/cache proof is a Railway preview of `apps/platform-web`. Railway is not an architectural dependency and is not Brand on `app.expadio.com`.

## Landed on this tip

- `classifyRequestPath` splits platform-product, brand, lab.
- Product APIs `/api/overview`, `/api/context`, `/api/workspaces`, `/api/journey-correlation` return `Cache-Control: private, no-store`.
- Those routes no longer echo `error.message`.
- `/api/overview`, `/api/context`, and `/api/workspaces` run `assertPlatformProductPayload` before JSON leaves. A customer-field token fails closed with the generic error body.
- `platformSafeLogLine` redacts addresses to `[redacted-addr]` / `[redacted-tel]` and refuses leftover customer-field tokens. Placeholders do not contain `email` or `phone`, so the scanner does not fight itself.
- Sending health product APIs `/api/communications/health` and `/api/communications/overview` use `assertPlatformSendingHealthPayload`. Channel names `email` / `whatsapp` are allowed. Address-field keys and address values are not. Health metadata is dropped on the product response.
- The health-route source scan covers comments. Address-field tokens must not appear in that file at all.
- Deployed log capture is still unproven.
- `/api/workspaces` is locked to `SHELL_PLATFORM_SECTIONS` and uses the generic denied body for unauthenticated callers.
- Brand CS-104 GET `/brand/api/journey` authorizes T/B/L + membership, then reads intents + latest attempt + `communication_deliveries.state` for COMMUNICATE. No configuration/metadata/snapshot/address columns.
- Brand Communications surface now observes COMMUNICATE + DELIVERY from that same read. Still no mutations.
- `delivered` is only claimed when provider state is `DELIVERED`.
- Platform `/api/journey-correlation` does not query executor or delivery tables.
- POST `/brand/api/journey` stays 405.

## Still open

- Runtime proof of logs and caches on a Railway preview of platform-web.
- Authenticated browser e2e and revoked-session checks.
- A live CS-104 row that actually has provider `DELIVERED` in this tenant.
