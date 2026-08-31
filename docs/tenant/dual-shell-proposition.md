# Dual-shell proposition — accepted shape

Status: Brand host kernel can authorize and serve `/api/brand/customers` after mapped keys + membership. Next app is not mounted. Not deployed. Not merged.
Hosts: `platform.expadio.com` (Platform), `app.expadio.com` (Brand).

## This increment

- `BRAND_HOST` / `PLATFORM_HOST` are literal product hosts.
- `authorizeBrandCustomerRequest` + `serveBrandCustomerRead` are the Brand host kernel.
- Host must be `app.expadio.com`. Path must be `/api/brand/customers`.
- Storage keys come from `platform.product_scope_bindings` via the shared directory.
- Membership is checked through `resolveEffectiveContext`. Platform `/api/tenant` is refused.
- `L-####` and SELECTED workspace/unit membership stay fail-closed. CRM still has no unit ownership.
- No Brand Next host, no lockfile change, no mutation, no auto-send.

## Still open

1. Mount a server-authorized Brand Next host on `app.expadio.com` (or `/brand/*` same-origin fallback with Brand chrome).
2. Wire the injected reader to canonical CRM under membership-checked mapped keys.
3. Platform PII proof on URLs/APIs/errors/logs/caches.
4. One Brand case → SCHEDULE → CREATE_TASK → COMMUNICATE → observed delivery.
