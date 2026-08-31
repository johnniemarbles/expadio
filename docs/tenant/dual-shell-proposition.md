# Dual-shell proposition — accepted shape

Status: Brand shell package started on draft branch. Not deployed. Not merged as product.
Source of truth for scope: `@expadio/tenancy` `ShellScope`.
Hosts: `platform.expadio.com` (Platform), `app.expadio.com` (Brand).
Repo folders `apps/platform-web` and `apps/brand-web` are not public paths.

## Reuse from PR #499 (`5334de0`)

- `ShellScope`, `SHELL_NAVIGATION`, `unresolvedShellScope`, `shellViewSelection`
- Canonical org-scoped reads in `apps/platform-web/lib/tenant-read-model.ts` (lab only)
- Fail-closed location until ownership is verified
- Distinct communication states
- Platform sidebar must not link `/tenant`

## This increment

- `@expadio/brand-web` is a Brand-audience package. It imports the shared contract.
- `mapShellScopeToStorageKeys()` refuses to invent UUIDs from T/B/L.
- Platform payload helper rejects customer-name / email / phone shaped content.
- Growth, Communications, Knowledge, Settings stay `SURFACE_NOT_CONNECTED`.
- No Brand Next host, no Clerk session, no live CRM call, no mutation.

## Still open

1. Server-authorized Brand host and audience transition.
2. Verified T→tenant_id, B→organization_id, L→operating_unit_id table used by both adapters.
3. Move customer reads out of the Platform lab and behind Brand audience checks.
4. Authenticated proof that Platform URLs/APIs/errors/logs/caches never contain customer PII.
5. One Brand case → SCHEDULE → CREATE_TASK → COMMUNICATE → observed delivery.

`/tenant` in `apps/platform-web` remains a labeled read-model lab.
