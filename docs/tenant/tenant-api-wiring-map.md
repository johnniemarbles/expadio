# Tenant API Wiring Map

Branch: feat/tenant-product-foundation

## Existing read surfaces

| Tenant need | Current route | Current limitation |
|---|---|---|
| Workspace context | GET /api/context | Platform organization model; tenant language still needed |
| Overview | GET /api/overview?organizationId= | Composed platform overview; not yet tenant Home contract |
| Customers / practices | GET /api/crm/accounts, GET /api/crm/contacts | DENTEX-oriented labels and no shared customer record |
| Communications | GET /api/communications/overview, providers, templates, fleet, spend | Strong platform control-plane data; tenant-safe presentation must hide custody details |
| Governance | GET /api/governance/reviews?organizationId= | Review data exists; action-specific tenant command contract required |
| Brain / knowledge | GET /api/brain/* | Proposal/evidence surfaces exist; tenant navigation should use business language |
| Scheduler health | GET /api/scheduler/health | Health evidence only; not a tenant follow-up schedule API |

## Missing neutral tenant contract

GET /api/tenant/home?account=&org=&location=

GET /api/tenant/work?account=&org=&location=&tab=

GET /api/tenant/customers?account=&org=&location=

GET /api/tenant/customers/:id

GET /api/tenant/customers/:id/activity

GET /api/tenant/customers/:id/work

GET /api/tenant/customers/:id/communications

GET /api/tenant/customers/:id/documents

GET /api/tenant/customers/:id/decisions

## Missing command contract

POST /api/tenant/work/:id/request-review
POST /api/tenant/work/:id/approve
POST /api/tenant/work/:id/request-changes
POST /api/tenant/follow-ups
POST /api/tenant/follow-ups/:id/schedule
POST /api/tenant/communications/:id/reconcile

Every command must re-check membership, visibility scope, action scope, entitlement, SoD and idempotency. Responses must return a persisted status and correlation/audit reference.

## Build boundary

The /tenant model workspace currently uses fixture data to validate UX. It must not be relabeled live until these tenant-safe APIs exist and the end-to-end neutral follow-up path proves:

case event → follow-up → review → schedule → queue → provider outcome → customer activity.

DENTEX can then consume the same contract with vertical-specific labels and workflow rules.
