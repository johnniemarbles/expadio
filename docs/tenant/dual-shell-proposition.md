# Dual-shell proposition — accepted shape

Status: Brand host kernel plus same-origin `/brand` fallback. Next Brand app is not a separate deploy. Not merged.
Hosts: `platform.expadio.com` (Platform), `app.expadio.com` (Brand). Fallback: `/brand/*` with Brand chrome.

## This increment

- `authorizeBrandCustomerRequest` + `serveBrandCustomerRead` remain the kernel.
- Product route: `app.expadio.com` `/api/brand/customers`.
- Same-origin fallback: any host + `/brand/api/customers` (mounted in platform-web, outside Platform `ShellFrame`).
- `0089` `lookup_product_scope_binding` resolves one ACTIVE T/B/L row without a prior tenant GUC.
- Injected reader is canonical `readCustomers` on membership-checked mapped keys.
- Lab `account`/`org` query params are refused on the Brand path.
- `L-####` and SELECTED membership stay fail-closed. No mutation, no auto-send, no lockfile change.

## Still open

1. Separate Brand Next deploy on `app.expadio.com` (fallback is not that host).
2. Platform PII proof on URLs/APIs/errors/logs/caches.
3. One Brand case → SCHEDULE → CREATE_TASK → COMMUNICATE → observed delivery.
