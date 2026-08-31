# Product scope directory — migration review

Status: table `0088_product_scope_bindings.sql` and lookup `0089_product_scope_lookup.sql` on draft #499. Wave 1 source closed. Not merged.

## Why 0088 / 0089

- `0083`–`0085` are unused numbers.
- `0086` is reserved by the social draft.
- `0087` is lead-capture provenance only.
- Earlier ChatGPT mapping attempt (`0061` in that branch narrative) was withdrawn; repo `0061` is industry-pack provenance and must not be reused.

## What this table is

`platform.product_scope_bindings` stores verified T/B/L → tenant/organization/operating-unit rows.

- Codes stay `T-####` / `B-####` / `L-####` or explicit `ALL`.
- Storage keys stay UUIDs that already exist in `platform.tenants`, `platform.organizations`, `platform.operating_units`.
- Empty table = mapping unavailable. No code is invented from a UUID and no UUID is invented from a code.
- One T-code cannot point at two tenant ids. One B-code cannot change tenant or organization. `ALL` cannot carry a unit id.

`platform.lookup_product_scope_binding(tenant, brand, location)` returns one ACTIVE row. It exists because the table is RLS-bound to `current_tenant_id()` and Brand requests only know product codes until mapping succeeds.

## What this table is not

- Not a second membership, IAM, or authorization engine.
- Not a completed Brand deploy on `app.expadio.com`.
- Not an allocator of product codes.
- Not Platform `/api/tenant`.
- No seed of Northstar / DENTEX / customer names.

## Application path

1. Brand request carries `tenant` / `brand` / `location` product codes.
2. `lookup_product_scope_binding` returns at most one row.
3. `createScopeDirectoryFromRows` feeds `authorizeBrandCustomerRequest`.
4. Membership is loaded after the mapped tenant GUC is set.
5. Canonical `readCustomers` runs on those keys. Same-origin route: `/brand/api/customers`.
6. Same binding authorizes CS-104 observation on `/brand/api/journey`. Brand Communications shows COMMUNICATE + DELIVERY only.

## Still open

- Separate Brand Next host on `app.expadio.com`.
- Runtime Platform PII proof on a Railway preview of platform-web.
- A live CS-104 row with provider `DELIVERED`.
