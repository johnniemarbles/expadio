import type {
  InstantiatedWorkflowBlueprint,
  WorkflowInstance,
  WorkflowStageTransitionRecord,
  WorkflowTransitionIntent,
} from './index.ts';

export type WorkflowTransitionErrorCode =
  | 'WORKFLOW_INSTANCE_NOT_RUNNING'
  | 'WORKFLOW_INSTANCE_REVISION_MISMATCH'
  | 'WORKFLOW_INSTANCE_BLUEPRINT_MISMATCH'
  | 'WORKFLOW_INSTANCE_STAGE_MISMATCH'
  | 'WORKFLOW_TARGET_STAGE_NOT_FOUND';

export class WorkflowTransitionError extends Error {
  readonly code: WorkflowTransitionErrorCode;

  constructor(code: WorkflowTransitionErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowTransitionError';
    this.code = code;
  }
}

/**
 * Applies an already-authorized stage transition deterministically.
 * Route, gate, condition, assignment and approval policy are intentionally
 * outside this function and must be satisfied before commit.
 */
export function commitWorkflowStageTransition(input: {
  readonly instance: WorkflowInstance;
  readonly blueprint: InstantiatedWorkflowBlueprint;
  readonly intent: WorkflowTransitionIntent;
}): {
  readonly instance: WorkflowInstance;
  readonly record: WorkflowStageTransitionRecord;
} {
  const { instance, blueprint, intent } = input;

  if (instance.state !== 'RUNNING') {
    throw new WorkflowTransitionError(
      'WORKFLOW_INSTANCE_NOT_RUNNING',
      `Workflow instance ${instance.instanceId} is ${instance.state}, not RUNNING.`,
    );
  }
  if (instance.revision !== intent.expectedRevision) {
    throw new WorkflowTransitionError(
      'WORKFLOW_INSTANCE_REVISION_MISMATCH',
      `Expected revision ${intent.expectedRevision}, current revision is ${instance.revision}.`,
    );
  }
  if (
    instance.blueprint.blueprintKey !== blueprint.blueprintKey
    || instance.blueprint.version !== blueprint.version
    || instance.blueprint.scope !== blueprint.scope
    || instance.workTypeKey !== blueprint.workTypeKey
  ) {
    throw new WorkflowTransitionError(
      'WORKFLOW_INSTANCE_BLUEPRINT_MISMATCH',
      'Workflow instance and instantiated blueprint do not match.',
    );
  }
  if (instance.currentStageKey !== intent.fromStageKey) {
    throw new WorkflowTransitionError(
      'WORKFLOW_INSTANCE_STAGE_MISMATCH',
      `Transition expected stage "${intent.fromStageKey ?? ''}", current stage is "${instance.currentStageKey ?? ''}".`,
    );
  }
  if (!blueprint.stages.some((stage) => stage.stageKey === intent.toStageKey)) {
    throw new WorkflowTransitionError(
      'WORKFLOW_TARGET_STAGE_NOT_FOUND',
      `Target stage "${intent.toStageKey}" is not part of the pinned blueprint.`,
    );
  }

  const nextRevision = instance.revision + 1;
  const updated: WorkflowInstance = {
    ...instance,
    currentStageKey: intent.toStageKey,
    revision: nextRevision,
    updatedAt: intent.requestedAt,
  };
  const record: WorkflowStageTransitionRecord = {
    instanceId: instance.instanceId,
    ...(instance.currentStageKey === undefined ? {} : { fromStageKey: instance.currentStageKey }),
    toStageKey: intent.toStageKey,
    fromState: instance.state,
    toState: updated.state,
    revision: nextRevision,
    transitionedBySubjectId: intent.requestedBySubjectId,
    transitionedAt: intent.requestedAt,
    ...(intent.reason === undefined ? {} : { reason: intent.reason }),
  };

  return { instance: updated, record };
}
