# Product scope directory — migration review

Status: table added on draft #499 as `0088_product_scope_bindings.sql`. Not merged.

## Why 0088

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

## What this table is not

- Not a second membership, IAM, or authorization engine.
- Not a Brand host and not a live CRM read.
- Not an allocator of product codes.
- Not Platform `/api/tenant`.
- No seed of Northstar / DENTEX / customer names.

## Application path

1. Repository lists active rows.
2. `@expadio/tenancy-persistence` `loadScopeDirectory` passes rows to `createScopeDirectoryFromRows`.
3. Both shells call `mapShellScopeToStorageKeys(scope, directory)`.
4. Brand customer reads use `planBrandCustomerRead` → `app.expadio.com` `/api/brand/customers` with `served: false` until a Brand host exists.

## Still open

- Server-authorized Brand host that actually serves `/api/brand/customers`.
- Membership check on the mapped keys before any CRM read.
- Platform PII proof.
- CS-104 journey on frozen executors.
