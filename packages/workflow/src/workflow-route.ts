import type {
  WorkflowTransitionGateContext,
  WorkflowTransitionGateDecision,
  WorkflowTransitionGateEvaluator,
} from './workflow-gate.ts';
import {
  allowedWorkflowGateDecision,
  blockedWorkflowGateDecision,
} from './workflow-gate.ts';

/**
 * Conservative single-pointer route evaluator.
 *
 * Supports:
 * - bootstrap into the first sequential stage;
 * - forward movement to the immediately next sequential stage;
 * - an explicit configured return route (`returnToStageKey`).
 *
 * Parallel stages fail closed until the runtime models multiple active branches.
 */
export class SequentialWorkflowRouteEvaluator implements WorkflowTransitionGateEvaluator {
  async evaluate(
    context: WorkflowTransitionGateContext,
  ): Promise<WorkflowTransitionGateDecision> {
    const { blueprint, fromStage, toStage, intent } = context;

    if (toStage.stageKey !== intent.toStageKey) {
      return blockedWorkflowGateDecision({
        blockers: [{ kind: 'ROUTE', code: 'WORKFLOW_ROUTE_TARGET_MISMATCH' }],
        trace: ['route:target-mismatch'],
      });
    }
    if (fromStage !== undefined && fromStage.stageKey !== intent.fromStageKey) {
      return blockedWorkflowGateDecision({
        blockers: [{ kind: 'ROUTE', code: 'WORKFLOW_ROUTE_SOURCE_MISMATCH' }],
        trace: ['route:source-mismatch'],
      });
    }
    if (fromStage?.isParallel === true || toStage.isParallel) {
      return blockedWorkflowGateDecision({
        blockers: [{ kind: 'ROUTE', code: 'WORKFLOW_PARALLEL_RUNTIME_UNSUPPORTED' }],
        trace: ['route:parallel-runtime-unsupported'],
      });
    }

    const sequential = [...blueprint.stages]
      .filter((stage) => !stage.isParallel)
      .sort((left, right) => left.sequence - right.sequence);

    if (fromStage === undefined) {
      const first = sequential[0];
      if (first?.stageKey === toStage.stageKey) {
        return allowedWorkflowGateDecision(['route:bootstrap:first-stage']);
      }
      return blockedWorkflowGateDecision({
        blockers: [{ kind: 'ROUTE', code: 'WORKFLOW_ROUTE_NOT_ALLOWED' }],
        trace: ['route:bootstrap:not-first-stage'],
      });
    }

    if (fromStage.returnToStageKey === toStage.stageKey) {
      return allowedWorkflowGateDecision(['route:configured-return']);
    }

    const currentIndex = sequential.findIndex((stage) => stage.stageKey === fromStage.stageKey);
    if (currentIndex < 0) {
      return blockedWorkflowGateDecision({
        blockers: [{ kind: 'ROUTE', code: 'WORKFLOW_ROUTE_SOURCE_NOT_FOUND' }],
        trace: ['route:source-not-found'],
      });
    }

    const next = sequential[currentIndex + 1];
    if (next?.stageKey === toStage.stageKey) {
      return allowedWorkflowGateDecision(['route:next-stage']);
    }

    return blockedWorkflowGateDecision({
      blockers: [{ kind: 'ROUTE', code: 'WORKFLOW_ROUTE_NOT_ALLOWED' }],
      trace: ['route:not-allowed'],
    });
  }
}
