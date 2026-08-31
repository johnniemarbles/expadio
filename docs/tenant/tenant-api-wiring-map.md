# Tenant API wiring — implemented read slice

All routes below require a Clerk session and exactly one UUID `account` (tenant)
and `org` query parameter. Headers and last-used cookies are not authorization.
All responses are `private, no-store`. The read transaction applies tenant, org
and subject context before the exact active-membership check and business reads.

| Route | Result | Existing persistence |
|---|---|---|
| `GET /api/tenant/context` | Verified brand/org names and `read-only` access | tenants, organizations, memberships |
| `GET /api/tenant/customers?account=&org=&limit=&offset=` | `{items, hasMore}` | crm_contacts + crm_accounts |
| `GET /api/tenant/customers/:id?account=&org=` | customer, cases, tasks, decisions, truncation flags | canonical CRM, operational_tasks, workflow_stage_decisions |
| `GET /api/tenant/work?account=&org=&limit=&offset=` | `{items, hasMore}` of case-linked tasks | operational_tasks + verified case/customer/account joins |

List limits default to 50, maximum 100; offset is 0–10000. Detail child sections
are capped at 100 and report truncation. There is no claim of complete queue totals.

Read policy: active exact issuer-bound user membership, active tenant/org, valid
membership window, ALL workspace and operating-unit scopes. Selected scopes are
denied until CRM has verified finer-grained ownership. Unknown, unowned or
archived customers are not disclosed. A missing/out-of-scope detail is 404.

The decision read also checks workflow subject type `crm.case` and exact case ID.
The task read accepts only the proven `crm.case` aggregate contract. Raw provider
payloads, actor identifiers, credentials, internal errors and audit correlation
metadata are not returned by these reads.

## Not implemented / no enabled controls

Home aggregate counts; server-side work-tab filtering; approvals and exceptions;
task assignment/completion; follow-up/review/schedule/send commands; customer
communication and document reads; role homes; authorized brand/location selector.
These are build work, not absent backend claims. Reuse canonical services when
their complete tenant-safe journey has been verified.

See [the feature map](../tenant-feature-map.md) for evidence and remaining gates.
