import type { PoolClient } from 'pg';
import { describeWorkflow } from './workflow-runtime';
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

export type GovernedAction =
  | { readonly type: 'DECIDE'; readonly outcomes: readonly string[] }
  | { readonly type: 'ASSIGN'; readonly slots: readonly string[] }
  | { readonly type: 'ADVANCE'; readonly toStages: readonly { readonly stageKey: string; readonly label: string }[] };

export interface AvailableActions {
  readonly instanceId: string;
  readonly currentStageKey: string | null;
  readonly state: string;
  readonly actions: readonly GovernedAction[];
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
 * now: ASSIGN while a required participant slot is unfilled, DECIDE while the
 * stage is decision-required and undecided, and ADVANCE once the current stage's
 * own gates are satisfied. Terminal instances offer nothing.
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
    return { instanceId, currentStageKey, state: described.instance.state, actions: [] };
  }

  const isAssigned = (slot: string) =>
    described.assignments.some((a) => a.stageKey === cur.stageKey && a.participantKey === slot && a.status === 'ASSIGNED');
  const unmet = cur.requiredParticipantKeys.filter((slot) => !isAssigned(slot));
  const needsDecision = cur.decisionRequired && described.currentDecision === null;

  const actions: GovernedAction[] = [];
  if (unmet.length > 0) actions.push({ type: 'ASSIGN', slots: unmet });
  if (needsDecision) actions.push({ type: 'DECIDE', outcomes: cur.decisionOutcomes });
  // A stage advances only once its own gates are met — advertise ADVANCE only then.
  if (unmet.length === 0 && !needsDecision) {
    const toStages = described.stages
      .filter((s) => s.stageKey !== cur.stageKey)
      .map((s) => ({ stageKey: s.stageKey, label: s.label }));
    if (toStages.length > 0) actions.push({ type: 'ADVANCE', toStages });
  }

  return { instanceId, currentStageKey, state: described.instance.state, actions };
}
