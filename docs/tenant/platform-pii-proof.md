# Platform PII proof — draft status

Keep #499 draft. This is a contract and source scan, not authenticated e2e.

## Landed on this tip

- `classifyRequestPath` splits platform-product, brand, lab.
- Product APIs `/api/overview`, `/api/context`, `/api/workspaces` return `Cache-Control: private, no-store`.
- Those routes no longer echo `error.message`.
- `/api/workspaces` is locked to `SHELL_PLATFORM_SECTIONS` (Home / My work / Tenants / Capabilities / Sending health / Providers / Approvals / Safety / Audit). CRM, GTM, DENTEX, vendors and expenses are not product nav.
- `assertPlatformPayloadHasNoCustomerPii` / `assertPlatformLogHasNoCustomerPii` reject email, phone and customer-field tokens. Organization names are allowed.
- Brand CS-104 is an observation plan only (`emptyBrandJourneyObservation`). Mutations stay off.

## Still open

- Runtime proof of logs and caches on a deployed preview.
- Lab surfaces (`/crm`, `/gtm`, `/dentex`, `/api/tenant`) still exist; they are classified as lab, not removed.
- Authenticated browser e2e and revoked-session checks.
- Observed delivery on frozen executors.
