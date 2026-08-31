# Tenant feature map — scoped read-model draft

Read slice verified at `0c11284`; dual-shell correction follows on `feat/tenant-product-foundation`.
This supersedes the earlier prototype-only map. The first operating product is
brand-neutral; Northstar Services is an explicitly read-only model, not a seeded
production tenant. DENTEX is a later vertical extension of the same work system.

**Not the tenant product. Keep PR #499 draft.** `/tenant` remains a read-model
lab in `apps/platform-web`, not a separate Brand app or a proven audience/PII
boundary. The Platform sidebar no longer links to it. The superseded Northstar
Dental HTML is removed from the PR tip; it is not navigation or product evidence.
See [the shared scope and dual-shell contract](tenant/shared-scope-contract.md).

The brand runs its business through connected work. EXPADIO executes, governs,
isolates and owns providers underneath. Home answers only: what needs me, what
is happening, what the system already finished.

## Build gate

**Ready** means the bounded implementation below is covered by local checks,
not deployed or fully authenticated-browser verified. **Partial** means part of
the read path exists but the product journey remains incomplete. **Planned**
means no tenant action is enabled. **Platform-only** must not enter tenant UI.

| Surface | Existing backend → tenant-safe API | Permission / scope | UI journey | Evidence / status |
|---|---|---|---|---|
| Tenant shell | Clerk identity + `memberships`, `tenants`, `organizations` → `GET /api/tenant/context` | Exact active issuer-bound membership; active brand/org; valid membership window; unrestricted workspace and location read scope | `/tenant` read-model lab in platform-web; compatibility UUID scope on links/reads | Partial: scoped reads only; separate Brand app, audience boundary, mapped product scope, selector, setup and role homes not implemented |
| Customers | `crm_contacts` joined to `crm_accounts.organization_id` → `GET /api/tenant/customers` | Tenant RLS + explicit organization join; exclude archived and unowned records | Paged list → one shared customer record | Ready, read-only; unit, database-engine and mounted-DOM checks |
| Overview | Customer + `crm_cases` → `GET /api/tenant/customers/:id` | Same scope; reject inconsistent case/account relationships | Customer details → connected cases | Ready, read-only; missing/cross-scope record returns 404 |
| Activity | Persisted customer, case, task and decision timestamps in customer detail | Same scoped children | Chronological record summary | Partial: explicitly not a full audit log |
| Tasks | `operational_tasks` → verified `crm.case` aggregate → scoped case/contact/account → work/detail API | Active org membership for reads; `isMine` uses authenticated subject | Customer Tasks; My tasks / Team queue / Overdue tabs | Partial: read-only; approvals, exceptions, assignment and completion not connected |
| Decisions | `workflow_stage_decisions` → `workflow_instances` → exact `crm.case` subject → scoped customer detail | Verify tenant, org, case relationship and workflow ownership | Recorded decisions alongside customer context | Ready, read-only; no approval command implied |
| Home | Case-linked operational task read → `GET /api/tenant/work` | Same scoped query | Needs me / happening; system-finished section explicitly unavailable | Partial: paged task subset, no invented totals or provider outcomes |
| Communications | Canonical delivery, governed action, schedule and provider execution infrastructure exists | Customer-safe associations, entitlement and action scope not yet verified here | Planned explanation only; customer tab states not connected | Partial backend / planned tenant journey |
| Documents | Existing document capability must be mapped to customer ownership | Customer-level read/download/share permission not verified | Customer tab states not connected | Planned |
| Growth | Existing growth-related infrastructure requires capability-specific verification | Tenant entitlement, approval and execution boundaries not mapped here | Planned explanation; no AutoGTM, social or inbound execution | Planned |
| Knowledge & AI | Existing knowledge/AI infrastructure requires tenant-safe source and proposal mapping | Source visibility, permitted knowledge changes and action controls not mapped here | Planned explanation only | Planned |
| Business settings | Existing membership/configuration infrastructure | Tenant admin command authorization separate from membership reads | Planned explanation of tenant-owned configuration | Planned |
| Provider custody | Providers, credentials, transport, execution and global safety | Platform authority only | Absent from tenant shell | Platform-only |
| DENTEX care/discharge | Industry packs and case lifecycle event mapping exist | Clinical role, real care objects, location and governed commands still require verification | Later extension after neutral path | Planned tenant journey; no renamed CRM substitution |

## Verified implementation references

- `apps/platform-web/lib/tenant-read-model.ts`: validation, read-only transaction,
  exact membership guard, tenant/org joins, canonical child reads, safe errors.
- `apps/platform-web/lib/tenant-api.ts`: authenticated read composition. Does not
  call the platform auto-provisioning membership resolver or trust scope headers.
- `apps/platform-web/app/tenant/`: draft read-model lab, not `apps/brand-web`.
- `packages/tenancy/src/shell-scope.ts`: shared scope definition for both
  audiences; runtime mapping and shell integration are not complete.
- `apps/platform-web/lib/tenant-model-fixture.ts`: one internally consistent,
  read-only customer/case/task example. Only explicit `?mode=model` uses it.
- `apps/platform-web/test/tenant-read-model.test.ts`: 16 unit/contract tests.
- `apps/platform-web/scripts/verify-tenant-read-model.mjs`: 12 isolated
  PostgreSQL-engine checks using actual relevant migrations and a NOBYPASSRLS role.
- `apps/platform-web/scripts/verify-tenant-workspace.mjs`: 10 mounted-DOM checks.

## Deliberate limits / release blockers

- Platform must not receive customer names/email/phone. Removing a sidebar link
  fixes navigation only; direct-route/API and server audience isolation remain
  unverified. Break-glass remains a request, not a PII drill-through.
- T/B/L identifiers, pack/residency and verified role homes form the product
  scope. Legacy UUIDs do not implement it. Defining the shared contract does not
  resolve mappings or add a new authorization model.

- CRM contacts do not have a verified operating-unit/location owner. Selected
  location/workspace memberships and explicit location/workspace filters receive
  a denial, not organization-wide data. No display-name-to-location inference.
- No brand enumeration is introduced. A verified workspace link supplies
  `account` and `org`; the authorized selector and onboarding are still required.
- Role-specific homes (owner, location manager, operator, approver) are not built.
- No tenant mutation is enabled. Approval, request changes, assignment,
  scheduling, retry and reconciliation need action-specific commands and tests.
- Work tabs filter the current page of case-linked tasks, labeled as a subset.
  Full queue counts, server-side tab filters and global overdue totals remain work.
- Detail sections return at most 100 records with explicit truncation notices.
- Activity is a persisted-timestamp summary, not complete audit provenance.
- Mobile navigation uses visible scrollable links; tables scroll independently.
  Customer detail uses a full page, not a drawer. Browser/mobile/screen-reader QA
  has not run; mounted-DOM tests are not that release gate.
- Full monorepo build, authenticated deployed e2e, performance plans and deployed
  database-role verification remain required before production readiness.

## Next executable journey — after dual-shell and scope gates

Brand case → `SCHEDULE` → `CREATE_TASK` → `COMMUNICATE` → observed delivery on
the same record, using frozen canonical executors. No mutations or auto-send
are enabled by this correction.
Scheduling may persist before approval only if dispatch remains blocked by policy.
Do not collapse approved, scheduled, queued, sent, delivered, failed or uncertain.

Before enabling any command: verify membership, visibility, action scope,
entitlement, maker/reviewer separation, idempotency, durable result and audit
reference. Exercise duplicate submit, denied action, provider failure and uncertain
outcome. Then extend this same path with real DENTEX care/discharge objects.

## Migration correction

The draft-only `0061_tenant_work_execution.sql` proposal is withdrawn: it
duplicated both an existing migration number and canonical task/scheduling
infrastructure. Reads use `0073_operational_tasks.sql`; future scheduling must
reuse `0071_scheduled_governed_actions.sql`. No database tables were dropped or
data deleted. If that draft migration was applied anywhere, investigate and plan
a separate data-preserving migration before release.
