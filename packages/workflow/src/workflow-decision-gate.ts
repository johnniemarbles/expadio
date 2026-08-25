import {
  allowedWorkflowGateDecision,
  blockedWorkflowGateDecision,
  type WorkflowTransitionGateContext,
  type WorkflowTransitionGateDecision,
  type WorkflowTransitionGateEvaluator,
} from './workflow-gate.ts';
import type { WorkflowStageDecisionProvider } from './workflow-decision.ts';

/**
 * Enforces the blueprint exit guard for decision-required stages. Decision
 * capture/authority/approval-chain mechanics remain behind the provider.
 */
export class WorkflowStageDecisionGateEvaluator
  implements WorkflowTransitionGateEvaluator {
  readonly #decisions: WorkflowStageDecisionProvider;

  constructor(decisions: WorkflowStageDecisionProvider) {
    this.#decisions = decisions;
  }

  async evaluate(
    context: WorkflowTransitionGateContext,
  ): Promise<WorkflowTransitionGateDecision> {
    const fromStage = context.fromStage;
    if (fromStage === undefined || !fromStage.decisionRequired) {
      return allowedWorkflowGateDecision(['decision:not-required']);
    }

    const decision = await this.#decisions.resolve({
      tenantId: context.instance.tenantId,
      instanceId: context.instance.instanceId,
      workTypeKey: context.instance.workTypeKey,
      stageKey: fromStage.stageKey,
    });

    if (decision === null || decision.status !== 'RECORDED' || decision.outcome === undefined) {
      return blockedWorkflowGateDecision({
        blockers: [{
          kind: 'DECISION',
          code: 'WORKFLOW_DECISION_REQUIRED',
          key: fromStage.stageKey,
        }],
        trace: ['decision:missing'],
      });
    }

    const allowedOutcomes = uniqueNonEmpty(fromStage.decisionOutcomes);
    if (allowedOutcomes.length > 0 && !allowedOutcomes.includes(decision.outcome)) {
      return blockedWorkflowGateDecision({
        blockers: [{
          kind: 'DECISION',
          code: 'WORKFLOW_DECISION_OUTCOME_INVALID',
          key: decision.outcome,
        }],
        trace: [`decision:${decision.code}:invalid-outcome`],
      });
    }

    return allowedWorkflowGateDecision([
      `decision:${decision.code}:${decision.outcome}`,
    ]);
  }
}

function uniqueNonEmpty(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}
