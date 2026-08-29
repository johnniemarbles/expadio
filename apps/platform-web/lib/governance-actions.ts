import type { PoolClient } from 'pg';
import { PostgresWorkflowInstanceRepository } from '@expadio/postgres-runtime/workflow-instance';
import { describeWorkflow, recordCaseDecision, makerForStage } from './workflow-runtime';
import { assignParticipant } from './workflow-participants';
import { SUBJECT_TABLES } from './verticals';

/**
 * The generic governed-action layer — slice 1 of cross-vertical actions (read
 * only). A reviewer's queue spans every vertical; to act on an item without
 * routing into that vertical's own UI we need two work-type-agnostic pieces:
 *
 *  1. resolve any (workTypeKey, subjectId) to its workflow instance, via the
 *     SUBJECT_TABLES registry, and
 *  2. derive what governed actions the current stage actually permits right now.
 *
 * No mutation happens here; this only advertises what is doable. The mutation
 * (a later slice) reuses the same registry + the shared decision/participant
 * factories, so the gates below and the gates enforced on write stay in step.
 * `table`/`idColumn` come from the registry (internal constants), never request
 * input, so interpolating them is safe; the subject id is parameterized.
 */

/**
 * A governed action the review queue can actually take on an item — exactly the
 * two the mutation endpoint (POST /api/governance/actions) performs. The read
 * model must stay an exact projection of the write model, so advancing — which
 * the queue does not perform (it belongs to the vertical's own screen) — is not
 * an action here but a readiness status (`canAdvance`) on the descriptor.
 */
export type GovernedAction =
  | { readonly type: 'DECIDE'; readonly outcomes: readonly string[] }
  | { readonly type: 'ASSIGN'; readonly slots: readonly string[] };

export interface AvailableActions {
  readonly instanceId: string;
  readonly currentStageKey: string | null;
  readonly state: string;
  readonly actions: readonly GovernedAction[];
  /**
   * The current stage's own gates are all met and the instance is live, so it is
   * ready to advance — but advancing is done in the vertical, not the queue, so
   * this is reported as a status rather than offered as a (non-existent) action.
   */
  readonly canAdvance: boolean;
}

/** Resolve a governed subject to its workflow instance id, or null. RLS-scoped. */
export async function resolveInstanceForSubject(
  client: PoolClient,
  input: { readonly workTypeKey: string; readonly subjectId: string },
): Promise<string | null> {
  const binding = SUBJECT_TABLES[input.workTypeKey];
  const subjectId = input.subjectId.trim();
  if (binding === undefined || subjectId === '') return null;
  const row = await client.query(
    `SELECT workflow_instance_id FROM ${binding.table} WHERE ${binding.idColumn} = $1::uuid`,
    [subjectId],
  );
  if (row.rows.length === 0) return null;
  return (row.rows[0].workflow_instance_id as string | null) ?? null;
}

/**
 * What governed actions the caller can take on a subject's current stage right
 * now: ASSIGN while a required participant slot is unfilled, and DECIDE while the
 * stage is decision-required and undecided — the two the mutation endpoint
 * performs. Once those gates are met the stage is ready to advance, reported as
 * `canAdvance` (advancing itself is a vertical-screen action, not a queue one).
 * Terminal instances offer nothing and cannot advance.
 */
export async function availableActions(
  client: PoolClient,
  input: { readonly tenantId: string; readonly workTypeKey: string; readonly subjectId: string },
): Promise<AvailableActions | null> {
  const instanceId = await resolveInstanceForSubject(client, input);
  if (instanceId === null) return null;
  const described = await describeWorkflow(client, { tenantId: input.tenantId, instanceId });
  if (described === null) return null;

  const currentStageKey = described.instance.currentStageKey ?? null;
  const terminal = ['COMPLETED', 'CANCELLED', 'FAILED'].includes(described.instance.state);
  const cur = currentStageKey === null ? undefined : described.stages.find((s) => s.stageKey === currentStageKey);
  if (terminal || cur === undefined) {
    return { instanceId, currentStageKey, state: described.instance.state, actions: [], canAdvance: false };
  }

  const isAssigned = (slot: string) =>
    described.assignments.some((a) => a.stageKey === cur.stageKey && a.participantKey === slot && a.status === 'ASSIGNED');
  const unmet = cur.requiredParticipantKeys.filter((slot) => !isAssigned(slot));
  const needsDecision = cur.decisionRequired && described.currentDecision === null;

  const actions: GovernedAction[] = [];
  if (unmet.length > 0) actions.push({ type: 'ASSIGN', slots: unmet });
  if (needsDecision) actions.push({ type: 'DECIDE', outcomes: cur.decisionOutcomes });
  // Gates all met on a live stage → ready to advance. The actual transition
  // (and which stage is legal) is the runtime's call, performed in the vertical;
  // here it is only a status, never advertised with target stages the runtime
  // might reject.
  const canAdvance = unmet.length === 0 && !needsDecision;

  return { instanceId, currentStageKey, state: described.instance.state, actions, canAdvance };
}

// ---------------------------------------------------------------------------
// Mutations — the write half of cross-vertical actions. Each resolves the
// subject to its instance via the registry, then performs the same governed
// primitive the vertical's own route would: a decision goes through
// recordCaseDecision (role + separation of duties + any authority deriver the
// work type registered), an assignment through assignParticipant. Callers gate
// on role and bind RLS before calling; the subject id is never trusted as SQL.
// ---------------------------------------------------------------------------

export type DecideOnSubjectResult =
  | { readonly ok: false; readonly reason: 'NO_WORKFLOW' | 'NO_STAGE' }
  | Awaited<ReturnType<typeof recordCaseDecision>>;

/** Record a decision on a subject's current stage, cross-vertical. */
export async function decideOnSubject(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly workTypeKey: string;
    readonly subjectId: string;
    readonly outcome: string;
    readonly approverSubjectId: string;
  },
): Promise<DecideOnSubjectResult> {
  const instanceId = await resolveInstanceForSubject(client, input);
  if (instanceId === null) return { ok: false, reason: 'NO_WORKFLOW' };
  const instance = await new PostgresWorkflowInstanceRepository(client).findById({ tenantId: input.tenantId, instanceId });
  if (instance === null || instance.currentStageKey === undefined) return { ok: false, reason: 'NO_STAGE' };
  const maker = await makerForStage(client, { tenantId: input.tenantId, instanceId, stageKey: instance.currentStageKey });
  return recordCaseDecision(client, {
    tenantId: input.tenantId,
    instanceId,
    workTypeKey: instance.workTypeKey,
    stageKey: instance.currentStageKey,
    outcome: input.outcome,
    approverSubjectId: input.approverSubjectId,
    makerSubjectId: maker,
  });
}

export type AssignOnSubjectResult =
  | { readonly ok: false; readonly reason: 'NO_WORKFLOW' }
  | { readonly ok: true; readonly assigned: Awaited<ReturnType<typeof assignParticipant>> };

/** Fill a participant slot on a subject's stage, cross-vertical. */
export async function assignOnSubject(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly workTypeKey: string;
    readonly subjectId: string;
    readonly stageKey: string;
    readonly participantKey: string;
    readonly targetKind: string;
    readonly targetKey: string;
    readonly assignedBySubjectId: string;
  },
): Promise<AssignOnSubjectResult> {
  const instanceId = await resolveInstanceForSubject(client, input);
  if (instanceId === null) return { ok: false, reason: 'NO_WORKFLOW' };
  const assigned = await assignParticipant(client, {
    tenantId: input.tenantId,
    instanceId,
    stageKey: input.stageKey,
    participantKey: input.participantKey,
    targetKind: input.targetKind,
    targetKey: input.targetKey,
    assignedBySubjectId: input.assignedBySubjectId,
  });
  return { ok: true, assigned };
}
