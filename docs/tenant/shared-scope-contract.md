# Shared scope contract — Platform and Brand

Status: definition implemented; dual-shell runtime integration not complete.
Keep #499 draft. The source of truth is `ShellScope` in
`packages/tenancy/src/shell-scope.ts`, exported by `@expadio/tenancy` for both
audiences. Do not introduce a separate Brand scope or authorization engine.

## Product object and storage boundary

`ShellScope` contains version, audience, tenant, brand, location, pack, residency
and role. Each context field is explicitly resolved or unresolved.

| Field | Meaning | Mapping / authority boundary |
|---|---|---|
| audience | Platform or Brand | Server-authorized audience; not a permission supplied by the client |
| tenant | T-#### | Verified mapping to tenant_id; never manufacture from a UUID |
| brand | B-#### | Verify owning tenant and organization; organization is not automatically a brand |
| location | L-#### or explicit all-permitted view | Verify Brand/operating-unit ownership and membership; unresolved does not mean all |
| pack | Published key/version, or verified neutral (null) | Descriptive context, never a count or data filter |
| residency | Verified residency designation | Descriptive context, never a count filter; not inferred from location/browser |
| role | Verified role key and home profile | Presentation only; not permission or an action grant |

Codes use the namespace prefix followed by at least four decimal digits. This
contract neither allocates codes nor adds mapping tables. No actual T/B/L
mapping has been verified in this read slice: leave it unresolved rather than
invent one. An unresolved pack must not silently become the neutral pack.

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
| Break-glass is a governed request, not a PII view | Platform authority alone does not grant Brand access |

These lists are exported as `SHELL_NAVIGATION`; they do not invent working
routes or claim the current Platform nav has already been migrated. A future
audience switch must reauthorize and clear prior audience data. Frontend labels,
a shared session, a scope query parameter or removal of a link do not establish
a server boundary.

## Integration gate — still open

1. Preserve the canonical scoped reads and tests. Remove Platform's sidebar link
   to /tenant and remove the superseded Northstar Dental HTML from the PR tip.
2. Establish the separate Brand app/shell composition (target apps/brand-web),
   importing this shared contract. The current /tenant in apps/platform-web is
   only a draft read-model lab. No app extraction or two-shell integration is
   claimed by this correction.
3. Implement the verified product/storage mappings and server scope adapters in
   both apps. Role homes remain owner, manager, operator and approver. Restricted
   location/workspace access stays fail-closed until its ownership is verified.
4. Prove Platform responses never contain customer PII through direct URLs,
   APIs, errors, logs or caches. Platform-to-Brand transitions require separate
   verified Brand authority. Sidebar removal is not proof of this isolation.
5. Test scoped counts, view/action separation, expired/revoked access, mobile,
   keyboard and authenticated browser e2e. Unit selection tests and mounted-DOM
   checks do not satisfy these gates.
6. Only then prove one Brand case → SCHEDULE → CREATE_TASK → COMMUNICATE →
   observed delivery on the same record using frozen executors. No auto-send,
   second engine, mutations now, DENTEX expansion, Social or lead-inbox merge.

The later Wave 1+2 directional fixture is not available in this correction's
supplied files; no replacement is fabricated. The written freeze and dual-shell
contract govern the draft. The tip and verified evidence, not intermediate
commit messages, describe the current implementation.
