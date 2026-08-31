# Shared scope contract — Platform and Brand

Status: Wave 1 source/CI closed on draft #499. Dual-shell runtime on Railway and Brand host on `app.expadio.com` are not closed.
The source of truth is `ShellScope` in
`packages/tenancy/src/shell-scope.ts`, exported by `@expadio/tenancy` for both
audiences. Do not introduce a separate Brand scope or authorization engine.

## Product object and storage boundary

`ShellScope` contains version, audience, tenant, brand, location, pack, residency
and role. Each context field is explicitly resolved or unresolved.

| Field | Meaning | Mapping / authority boundary |
|---|---|
| audience | Platform or Brand | Server-authorized audience; not a permission supplied by the client |
| tenant | T-#### | Verified mapping to tenant_id; never manufacture from a UUID |
| brand | B-#### | Verify owning tenant and organization; organization is not automatically a brand |
| location | L-#### or explicit all-permitted view | Verify Brand/operating-unit ownership and membership; unresolved does not mean all |
| pack | Published key/version, or verified neutral (null) | Descriptive context, never a count or data filter |
| residency | Verified residency designation | Descriptive context, never a count filter; not inferred from location/browser |
| role | Verified role key and home profile | Presentation only; not permission or an action grant |

Codes use the namespace prefix followed by at least four decimal digits. This
contract does not allocate codes. Persistence lives in
`platform.product_scope_bindings` (migration 0088). Lookup is
`platform.lookup_product_scope_binding` (migration 0089). An empty table is still
unresolved mapping. An unresolved pack must not silently become the neutral pack.

`ShellScopeStorageKeys` describes tenantId, organizationId and operatingUnitId
behind the adapter. Existing account/org parameters remain compatibility inputs
to the read lab, not the product contract. A server adapter must verify the
T-to-tenant, B-to-tenant/organization and L-to-Brand/operating-unit relationships
against current membership before using the mapped keys.

`shellViewSelection()` extracts only audience and resolved T/B/L selection.
It is not a query, cache key or authorization proof. Pack, residency and role
presentation do not alter that selection. Reads and counts must still resolve
current visibility server-side. A real role/permission change invalidates old
results even when the selected T/B/L values do not change.

No customer names, email, phone, subject identity, permission arrays, canApprove
or canSend fields belong in this shared scope object. View selection is not
action scope. Commands must use existing IAM, Decision and Governed Action
checks for current entitlement, resource/location access, maker/reviewer
separation, idempotency and policy. No commands are enabled in this correction.

## Dual-shell boundaries

| Platform | Brand |
|---|---|
| Home / My work / Tenants / Capabilities / Sending health / Providers / Approvals / Safety / Audit | Home / My work / Customers / Communications / Growth / Knowledge / Settings |
| Opaque operational identifiers and non-PII summaries | Scoped shared customer record |
| No customer names, email, phone or customer drill-through | Separate server-authorized audience and payload contract |
| Sending health may name a channel; it may not name a recipient | Communications observes CS-104 COMMUNICATE + DELIVERY only |
| Break-glass is a governed request, not a PII view | Platform authority alone does not grant Brand access |

These lists are exported as `SHELL_NAVIGATION`. Platform product workspaces now
serve that list. Lab routes remain in the tree and stay classified as lab.
A future audience switch must reauthorize and clear prior audience data.

Brand customer reads are authorized by `authorizeBrandCustomerRequest` on
`app.expadio.com` `/api/brand/customers`, or the same-origin fallback
`/brand/api/customers`. The kernel serves an injected canonical CRM reader after
membership resolution. These reads must not call Platform `/api/tenant`.
`L-####` and SELECTED membership stay fail-closed until CRM unit ownership is
proven. Platform `ShellFrame` must not link `/brand` or `/tenant`.

## Integration gates

Closed on this tip (source + CI only):

1. Canonical scoped reads and tests preserved. Platform sidebar does not treat `/tenant` as product nav. Superseded Northstar Dental HTML is not on the product surface.
2. Shared `ShellScope` + `SHELL_NAVIGATION` used by both audiences. `/brand` is mounted as same-origin fallback outside Platform chrome.
3. Verified product/storage mapping table 0088 + lookup 0089. Empty table fail-closes. Role homes remain owner, manager, operator and approver.
4. Platform product URLs/APIs/errors use the PII contract. Sending-health product APIs use a channel-aware scanner.
5. Brand Communications observes CS-104 COMMUNICATE + DELIVERY. POST journey is 405. No auto-send.

Still open (not source):

1. Separate Brand Next host on `app.expadio.com`. `/brand` is not that deploy.
2. Runtime logs and caches on a Railway preview of platform-web.
3. Authenticated browser e2e, expired/revoked access, mobile and keyboard.
4. A live CS-104 correlation that actually carries provider `DELIVERED`.
5. No DENTEX expansion, Social, lead-inbox merge, or second engine.
