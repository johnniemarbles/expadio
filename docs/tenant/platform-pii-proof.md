# Platform PII proof — draft status

Keep #499 draft. This is a contract and source scan, not authenticated e2e.

## Landed on this tip

- `classifyRequestPath` splits platform-product, brand, lab.
- Product APIs `/api/overview`, `/api/context`, `/api/workspaces`, `/api/journey-correlation` return `Cache-Control: private, no-store`.
- Those routes no longer echo `error.message`.
- `/api/workspaces` is locked to `SHELL_PLATFORM_SECTIONS` (Home / My work / Tenants / Capabilities / Sending health / Providers / Approvals / Safety / Audit).
- Lab surfaces (`/crm`, `/gtm`, `/dentex`, `/vendors`, `/expenses`, `/access-requests`, `/authority`) still exist. Contract tests pin those pages, not product nav.
- Governance subtools stay under `/governance/*` and the Governance Center directory. Product nav has one Approvals entry (`/governance`) and My work (`/governance/queue`).
- `assertPlatformPayloadHasNoCustomerPii` / `assertPlatformLogHasNoCustomerPii` reject email, phone and customer-field tokens. Organization names are allowed.
- Brand CS-104 GET `/brand/api/journey` authorizes with the same T/B/L + membership gate, then reads `governed_action_intents` + latest attempt + `communication_deliveries.state` joined on tenant + idempotency key for COMMUNICATE only.
- The query does not select `configuration`, `metadata`, `dispatch_snapshot`, `last_reason`, or recipient fields.
- SUCCEEDED COMMUNICATE maps to `sent`. `delivered` is only claimed when `communication_deliveries.state = DELIVERED`. SCHEDULE / CREATE_TASK success stays `queued`.
- Platform `/api/journey-correlation` still returns only `platformViewOfJourney` and does not query executor or delivery tables.
- POST `/brand/api/journey` stays 405. No auto-send.

## Still open

- Runtime proof of logs and caches on a deployed preview.
- Authenticated browser e2e and revoked-session checks.
- A live CS-104 row that actually has provider `DELIVERED` in this tenant.
