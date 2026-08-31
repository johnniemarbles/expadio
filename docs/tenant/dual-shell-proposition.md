# Dual-shell proposition — accepted shape

Status: Brand shell + verified in-memory T/B/L directory on the draft branch. Not deployed. Not merged.
Hosts: `platform.expadio.com` (Platform), `app.expadio.com` (Brand).

## This increment

- `createScopeDirectory(bindings)` is the shared adapter both shells call.
- Bindings are explicit. A T-code never becomes a UUID by string transform.
- Empty directory or missing row fails closed.
- `all-permitted` does not satisfy a specific `L-####` view.
- One T-code cannot map to two tenant ids in the same directory.
- `apps/brand-web/package.json` was removed so CI frozen-lockfile stays valid. Brand runtime is `@expadio/tenancy` `brandWorkspace`.

## Still open

1. Persist the directory in a real mapping table after a non-colliding migration review.
2. Server-authorized Brand host.
3. Brand-audience customer reads (not `/api/tenant` on Platform).
4. Platform PII proof on URLs/APIs/errors/logs/caches.
5. One Brand case → SCHEDULE → CREATE_TASK → COMMUNICATE → observed delivery.
