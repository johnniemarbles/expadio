# Decision Fabric — how a CRM case runs on a governed workflow

**Status:** Implementation note
**Scope:** `apps/platform-web` case workflow wiring over `@expadio/workflow` + `@expadio/postgres-runtime`

A CRM **case** (`platform.crm_cases`) is a first-class business entity that also
binds to a governed **workflow instance**. This note maps the moving parts so a
maintainer can find where each rule lives. Nothing here is new domain logic — the
pure workflow domain and its Postgres adapters already existed; the app supplies
a thin seam that drives them from governed HTTP routes.

## Layering

| Layer | Where | Responsibility |
|-------|-------|----------------|
| Pure domain | `packages/workflow` | Blueprint instantiation, the transition state machine (`commitWorkflowStageTransition`), and the gate evaluators (decision, participant) + authority/decision-capture contracts. No persistence, no transport. |
| Persistence adapters | `packages/postgres-runtime` | `PostgresWorkflowBlueprintRepository`, `PostgresWorkflowInstanceRepository` (atomic `commitTransition`), `PostgresWorkflowStageDecisionRepository`. Each takes a client already bound to the tenant RLS context. |
| App seam | `apps/platform-web/lib/workflow-runtime.ts` | `startWorkflow`, `transitionWorkflow`, `recordCaseDecision`, `describeWorkflow`, `loadCaseWorkflowHistory`. Composes the domain + adapters; owns gate ordering and the auto-complete step. |
| App authority | `apps/platform-web/lib/workflow-authority.ts` + `workflow-participants.ts` | `RoleAndSeparationOfDutiesAuthorityProvider` (four-eyes + governing-role, records role evidence) and the Postgres participant-assignment provider. |
| Routes | `apps/platform-web/app/api/crm/cases/[id]/workflow[/…]` | `resolveRequestContext`-scoped; reads require membership, writes a governing role. Mirror the instance's current stage onto the case's `stage_key`. |
| Surface | `apps/platform-web/app/(shell)/crm/CrmClient.tsx` | The Cases tab: start, assign, decide, advance, completed badge, and a trace modal. |

## Tables (all tenant-scoped)

- `platform.workflow_blueprints` — the `crm.case@1` PLATFORM blueprint is seeded in migration `0049` and given a `reviewer` participant slot on `REVIEW` in `0050`. Platform blueprints (`tenant_id IS NULL`) are visible to every tenant.
- `platform.workflow_instances` — **mutable** under RLS (state, current stage, revision).
- `platform.workflow_instance_transitions` — **append-only** (BEFORE UPDATE/DELETE trigger rejects mutation).
- `platform.workflow_stage_decisions` — **immutable** (one per instance/stage; trigger rejects mutation).
- `platform.workflow_participant_assignments` — one row per instance/stage/slot (migration `0050`, RLS-forced).

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
- **Separation of duties** — the approver must not be the maker who advanced the case into the stage (`makerForStage` = latest transition into the current stage). Self-approval → `WORKFLOW_SOD_SELF_APPROVAL`.

Evidence (`authority:role:…`, `sod:maker:…`, `sod:checker:…`) lands in the decision's immutable `evidence_refs` and surfaces in the trace.

## Validation note

The package test harness is strip-types (no DB) + SQL smoke tests; it does not
execute the TS adapters against a database. Each workflow slice was therefore
validated end-to-end against a real Postgres 16 during development (start →
gates → decision → four-eyes/role → auto-complete → trace). This is how the
latent ambiguous-`revision` bug in `commitTransition`'s `RETURNING` was caught
(fixed in the wiring PR): the CTE had never run against real Postgres.

## Extending

Further gates (entry/exit conditions, blocking requirements) and authority
dimensions (delegation, organization scope, monetary thresholds) attach to the
same evaluation points — a new gate evaluator in the ordered list, or a new
requirement consumed by the authority provider via `context.requirements`.
