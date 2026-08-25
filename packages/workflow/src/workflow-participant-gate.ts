import {
  allowedWorkflowGateDecision,
  blockedWorkflowGateDecision,
  type WorkflowGateBlocker,
  type WorkflowTransitionGateContext,
  type WorkflowTransitionGateDecision,
  type WorkflowTransitionGateEvaluator,
} from './workflow-gate.ts';
import {
  isWorkflowParticipantAssignmentBlocking,
  type WorkflowParticipantAssignmentProvider,
} from './workflow-participant-assignment.ts';

/**
 * Evaluates the target stage's semantic participant slots against an injected
 * assignment provider. Assignment strategy and persistence remain outside the
 * workflow engine.
 */
export class WorkflowParticipantAssignmentGateEvaluator
  implements WorkflowTransitionGateEvaluator {
  readonly #assignments: WorkflowParticipantAssignmentProvider;

  constructor(assignments: WorkflowParticipantAssignmentProvider) {
    this.#assignments = assignments;
  }

  async evaluate(
    context: WorkflowTransitionGateContext,
  ): Promise<WorkflowTransitionGateDecision> {
    const participantKeys = uniqueNonEmpty(context.toStage.requiredParticipantKeys);
    if (participantKeys.length === 0) {
      return allowedWorkflowGateDecision(['participant-assignment:none-required']);
    }

    const assignments = await this.#assignments.resolve({
      context: {
        tenantId: context.instance.tenantId,
        instanceId: context.instance.instanceId,
        workTypeKey: context.instance.workTypeKey,
        stageKey: context.toStage.stageKey,
      },
      participantKeys,
    });
    const byKey = new Map(assignments.map((assignment) => [assignment.participantKey, assignment]));
    const blockers: WorkflowGateBlocker[] = [];
    const trace: string[] = [];

    for (const participantKey of participantKeys) {
      const assignment = byKey.get(participantKey);
      if (assignment === undefined) {
        trace.push(`participant:${participantKey}:missing`);
        blockers.push({
          kind: 'PARTICIPANT',
          code: 'WORKFLOW_PARTICIPANT_ASSIGNMENT_MISSING',
          key: participantKey,
        });
        continue;
      }

      trace.push(`participant:${participantKey}:${assignment.code}`);
      if (isWorkflowParticipantAssignmentBlocking(assignment)) {
        blockers.push({
          kind: 'ASSIGNMENT',
          code: assignment.code,
          key: participantKey,
        });
      }
    }

    return blockers.length === 0
      ? allowedWorkflowGateDecision(trace)
      : blockedWorkflowGateDecision({ blockers, trace });
  }
}

function uniqueNonEmpty(keys: readonly string[]): readonly string[] {
  return [...new Set(keys.map((key) => key.trim()).filter((key) => key.length > 0))];
}
