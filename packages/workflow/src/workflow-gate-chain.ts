import {
  allowedWorkflowGateDecision,
  type WorkflowTransitionGateContext,
  type WorkflowTransitionGateDecision,
  type WorkflowTransitionGateEvaluator,
} from './workflow-gate.ts';

/**
 * Runs workflow gate evaluators in order and short-circuits at the first block.
 * This keeps route/condition/requirement, participant/assignment, approval and
 * authorization gates independently testable while preserving deterministic
 * evaluation order.
 */
export class OrderedWorkflowTransitionGateEvaluator
  implements WorkflowTransitionGateEvaluator {
  readonly #evaluators: readonly WorkflowTransitionGateEvaluator[];

  constructor(evaluators: readonly WorkflowTransitionGateEvaluator[]) {
    this.#evaluators = [...evaluators];
  }

  async evaluate(
    context: WorkflowTransitionGateContext,
  ): Promise<WorkflowTransitionGateDecision> {
    const trace: string[] = [];

    for (const evaluator of this.#evaluators) {
      const decision = await evaluator.evaluate(context);
      trace.push(...decision.trace);
      if (!decision.allowed) {
        return {
          allowed: false,
          blockers: [...decision.blockers],
          trace,
        };
      }
    }

    return allowedWorkflowGateDecision(trace);
  }
}
