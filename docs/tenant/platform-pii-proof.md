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
- Brand CS-104 is GET-only (`/brand/api/journey`). Platform keeps only the correlation (`/api/journey-correlation`). Mutations stay off.

## Still open

- Runtime proof of logs and caches on a deployed preview.
- Authenticated browser e2e and revoked-session checks.
- Observed delivery on frozen executors.
