# Decision Fabric — how any business entity runs on the governed workflow engine

**Status:** Implementation note
**Scope:** `apps/platform-web` workflow wiring over `@expadio/workflow` + `@expadio/postgres-runtime`

A governed business entity — a CRM **case** (`platform.crm_cases`), a **vendor**
(`platform.vendors`), an **expense** (`platform.expense_reports`), an **access
request** (`platform.access_requests`) — is a
first-class record that also binds to a governed **workflow instance**. The same
runtime drives all of them; nothing in the transition/decision path names a
particular vertical. This note maps the moving parts so a maintainer can find
where each rule lives, and gives the recipe for adding a vertical. The pure
workflow domain and its Postgres adapters already existed; the app supplies a
thin, work-type-agnostic seam that drives them from governed HTTP routes.

## The verticals

Each vertical is the same engine over a different subject and blueprint. What
differs is only the binding record, the seeded blueprint, and how approval
authority is derived.

| Work type | Subject table | Blueprint (PLATFORM) | Approval authority derived from |
|-----------|---------------|----------------------|---------------------------------|
| `crm.case` | `platform.crm_cases` | `0049`/`0050` | the case account's most valuable ACTIVE **agreement** (monetary threshold, org-scoped) |
| `vendor.onboarding` | `platform.vendors` | `0053` (v1), `0054` (v2 adds a decision-required `APPROVAL`) | **nothing** — role + separation of duties only |
| `expense.reimbursement` | `platform.expense_reports` | `0055` | the expense's **own amount** (`amount_minor_units`), tenant-scoped |
| `access.request` | `platform.access_requests` | `0056` | **nothing** — role + separation of duties only (a `security_reviewer` who is not the requester) |

The authority basis is the one genuinely per-vertical decision, and it is a
registered strategy — see **Authority derivation seam** below. Four verticals
share the engine today; each was added purely additively, and the newest
(`access.request`) was built by following the **Adding a vertical** recipe.

## Layering

| Layer | Where | Responsibility |
|-------|-------|----------------|
| Pure domain | `packages/workflow` | Blueprint instantiation, the transition state machine (`commitWorkflowStageTransition`), and the gate evaluators (decision, participant) + authority/decision-capture contracts. No persistence, no transport. |
| Persistence adapters | `packages/postgres-runtime` | `PostgresWorkflowBlueprintRepository`, `PostgresWorkflowInstanceRepository` (atomic `commitTransition`), `PostgresWorkflowStageDecisionRepository`. Each takes a client already bound to the tenant RLS context. |
| App seam | `apps/platform-web/lib/workflow-runtime.ts` | `startWorkflow`, `transitionWorkflow`, `recordCaseDecision`, `describeWorkflow`, `loadCaseWorkflowHistory`. Composes the domain + adapters; owns gate ordering and the auto-complete step. Takes an arbitrary `subjectType` / `workTypeKey` — it does not name a vertical. |
| Authority derivation | `apps/platform-web/lib/workflow-authority-derivation.ts` | A `workTypeKey → deriver` registry. `deriveAuthorityRequirements` dispatches; a work type with no registered deriver has no monetary/scope requirement. |
| App authority | `apps/platform-web/lib/workflow-authority.ts` + `workflow-authority-grants.ts` + `workflow-participants.ts` | `RoleAndSeparationOfDutiesAuthorityProvider` (four-eyes + governing-role, monetary/org-scope/delegation), the authority-grant reader/writer, and the Postgres participant-assignment provider. |
| Routes | `apps/platform-web/app/api/{crm/cases,vendors,expenses,access-requests}/[id]/workflow[/…]` | `resolveRequestContext`-scoped; reads require membership, writes a governing role. Mirror the instance's current stage onto the subject's `stage_key`. Per vertical: `route` (start/advance), `participants`, `decision`, `history`. |
| Surface | `apps/platform-web/app/(shell)/{crm,vendors,expenses,access-requests}` + `WorkflowTraceModal.tsx` | Each vertical's tab: start, assign, decide, advance, status, and a shared trace overlay. A decision denied for insufficient authority links to the Approval Authority page. |
| Governance layer | `apps/platform-web/app/(shell)/authority` + `app/(shell)/governance/decisions` (`lib/governance-decisions.ts`) | The Approval Authority admin page (grant/inspect the authority the decision gate enforces) and the tenant-wide governed-decision oversight log — every immutable decision across all verticals, filterable, with its authority/SoD evidence. |

## Tables (all tenant-scoped, RLS `ENABLE` + `FORCE`)

- `platform.workflow_blueprints` — PLATFORM blueprints (`tenant_id IS NULL`) are visible to every tenant; the resolver picks the highest-version ACTIVE row, so a v2 supersedes v1 while existing instances keep resolving their own version by identity.
- `platform.workflow_instances` — **mutable** under RLS (state, current stage, revision).
- `platform.workflow_instance_transitions` — **append-only** (BEFORE UPDATE/DELETE trigger rejects mutation).
- `platform.workflow_stage_decisions` — **immutable** (one per instance/stage; trigger rejects mutation).
- `platform.workflow_participant_assignments` — one row per instance/stage/slot.
- `platform.workflow_authority_grants` — per-subject approval-authority grants (monetary ceiling, org scope, delegation).
- The subject tables (`crm_cases`, `vendors`, `expense_reports`, `access_requests`) each carry the same binding seam: `blueprint_key`, `workflow_instance_id`, `stage_key`.

Because the app connects as the database **owner** (not a superuser), every
tenant-scoped table must be `FORCE ROW LEVEL SECURITY` with a policy — an owner
bypasses plain `ENABLE`. `infra/db/tests/rls_coverage_smoke.sql` fails the build
if any `tenant_id` table is missing enable/force/policy, and
`test-integration/rls-isolation.itest.ts` proves the mechanism actually blocks
cross-tenant access under a non-superuser role.

## The transition gate order (`transitionWorkflow`)

For a move into a target stage, the runtime evaluates, in order, and blocks on the first failure — nothing is written unless all pass:

1. **Structural** — `commitWorkflowStageTransition` checks the instance is `RUNNING`, the `expectedRevision` matches (optimistic concurrency), the blueprint/stage line up.
2. **Decision gate** — leaving a `decisionRequired` stage needs a recorded decision with an allowed outcome (`WorkflowStageDecisionGateEvaluator`).
3. **Participant gate** — the target stage's `requiredParticipantKeys` must be filled (`WorkflowParticipantAssignmentGateEvaluator`).
4. **Commit** — `commitTransition` atomically bumps the instance and appends the transition row.
5. **Auto-complete** — landing on the terminal stage appends a second, governed `RUNNING → COMPLETED` transition (`completed_at` set).

## Decision capture (`recordCaseDecision`)

Runs through `AuthorityGatedWorkflowDecisionCaptureService`, which evaluates authority **before** persisting:

- **Governing role** — the approver must hold a role (tenant owner/admin or platform admin); the satisfying role is recorded as `authority:role:<ROLE>` evidence. No role → `WORKFLOW_AUTHORITY_ROLE_MISSING`.
- **Separation of duties** — the approver must not be the maker who advanced the subject into the stage (`makerForStage` = latest transition into the current stage). Self-approval → `WORKFLOW_SOD_SELF_APPROVAL`.
- **Authority requirements** — any requirements from the derivation seam (below) are enforced: a monetary requirement needs a `monetary.approval` grant whose ceiling covers it, honoring org scope and delegation. Under the ceiling → `WORKFLOW_AUTHORITY_THRESHOLD`.

Evidence (`authority:role:…`, `authority:monetary:…`, `sod:maker:…`, `sod:checker:…`) lands in the decision's immutable `evidence_refs` and surfaces in the trace.

### Authority derivation seam

`recordCaseDecision` never queries a vertical's tables for its threshold; it
calls `deriveAuthorityRequirements(client, { tenantId, instanceId, workTypeKey })`
from `workflow-authority-derivation.ts`, which dispatches to the deriver
registered for that work type:

- `crm.case` → the account-agreement query.
- `expense.reimbursement` → the expense's own `amount_minor_units`.
- `vendor.onboarding` → **no deriver**, so `[]` — role + SoD alone gate it.

Dispatch is keyed by work type, not by the subject's table, so adding a
vertical-appropriate requirement is a one-function `registerAuthorityDeriver`
call with no change to the runtime.

## Validation

`pnpm test` (the app's contract tests) is source-shape + pure-TS and does not
touch a database. The **integration harness** `test-integration/*.itest.ts`
(`pnpm test:integration`, run in the CI **Workflow Integration** job) drives the
real `workflow-runtime` seam against a live Postgres 16 with all migrations
applied — start → gates → decision → four-eyes/role/monetary → auto-complete →
trace, across all three verticals. The **Core Spine** job runs the SQL smoke
checks in `infra/db/tests/*.sql` (blueprint shapes, table constraints, RLS
coverage) against the same fresh database. Any workflow change must go green on
both.

## Adding a vertical

The engine is work-type-agnostic, so a new vertical is additive — no runtime
change. Mirror an existing vertical: `access.request` is the most recent
worked example (role + SoD gated), `expense.reimbursement` the one with an
amount-based authority deriver:

1. **Migration** — a subject table (tenant-scoped, `ENABLE` + `FORCE` RLS + a `tenant_id = platform.current_tenant_id()` policy) carrying the binding seam (`blueprint_key`, `workflow_instance_id`, `stage_key`); and a PLATFORM `workflow_blueprints` row (`tenant_id NULL`, `state ACTIVE`) whose `stages` JSON uses the camelCase `WorkflowStageDefinition` shape. Put required participant slots and `decisionRequired` where the process needs a gate.
2. **Authority (optional)** — if approval should clear a monetary/scope threshold, `registerAuthorityDeriver('<work.type>', …)` in `workflow-authority-derivation.ts`, reading whatever the subject makes authoritative. Omit it for role + SoD only.
3. **Routes** — clone the vendor routes under `app/api/<vertical>/…`: list/create, `[id]/workflow` (GET/POST/PATCH), `participants`, `decision`, `history`. They are analogues with the table/subject swapped; keep the `hasCrmWriteRole` gate and the `BEGIN` + `applyTo` transaction pattern so RLS holds across multi-statement writes.
4. **Surface** — a `(shell)/<vertical>` page + client (file/register → assign → decide → advance), reusing `WorkflowTraceModal`; add a nav entry in `app/api/workspaces/route.ts`.
5. **Tests** — an `*.itest.ts` that drives the lifecycle (including the gate denials) against real Postgres; a `*_smoke.sql` for the blueprint/table shape; and a `test/*.test.ts` contract test asserting the route/UI/migration shapes.
