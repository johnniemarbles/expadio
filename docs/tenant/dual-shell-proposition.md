# Dual-shell proposition — accepted shape

Status: Brand shell + verified T/B/L directory, now persisted as `platform.product_scope_bindings` (0088) on the draft branch. Not deployed. Not merged.
Hosts: `platform.expadio.com` (Platform), `app.expadio.com` (Brand).

## This increment

- Restored `memberships` on `ResolveEffectiveContextInput` (CI typecheck).
- `0088_product_scope_bindings.sql` is the mapping table. Codes are not allocated.
- `loadScopeDirectory` in `@expadio/tenancy-persistence` feeds `createScopeDirectoryFromRows`.
- `planBrandCustomerRead` binds Home/Customers to `app.expadio.com` `/api/brand/customers` with `served: false`.
- Brand reads refuse Platform `/api/tenant`.
- Empty directory still fails closed. `ALL` still does not satisfy `L-####`.

## Still open

1. Server-authorized Brand host that serves the reserved Brand route.
2. Membership-checked Brand CRM reads on the mapped keys.
3. Platform PII proof on URLs/APIs/errors/logs/caches.
4. One Brand case → SCHEDULE → CREATE_TASK → COMMUNICATE → observed delivery.
