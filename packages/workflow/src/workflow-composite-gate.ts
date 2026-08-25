import type { WorkflowConditionEvaluator } from './workflow-condition-evaluator.ts';
import type {
  WorkflowGateBlocker,
  WorkflowTransitionGateContext,
  WorkflowTransitionGateDecision,
  WorkflowTransitionGateEvaluator,
} from './workflow-gate.ts';
import { allowedWorkflowGateDecision, blockedWorkflowGateDecision } from './workflow-gate.ts';
import type { WorkflowRequirementStatusProvider } from './workflow-requirement.ts';
import { isWorkflowRequirementBlocking } from './workflow-requirement.ts';

/**
 * Composes the first universal workflow gate layers in deterministic order:
 * route -> current-stage exit conditions -> current-stage blocking requirements
 * -> target-stage entry conditions.
 *
 * Approval, participant/assignment and authorization gates are intentionally
 * added by later dedicated evaluators instead of being implied here.
 */
export class CompositeWorkflowTransitionGateEvaluator implements WorkflowTransitionGateEvaluator {
  readonly #route: WorkflowTransitionGateEvaluator;
  readonly #conditions: WorkflowConditionEvaluator;
  readonly #requirements: WorkflowRequirementStatusProvider;

  constructor(input: {
    readonly route: WorkflowTransitionGateEvaluator;
    readonly conditions: WorkflowConditionEvaluator;
    readonly requirements: WorkflowRequirementStatusProvider;
  }) {
    this.#route = input.route;
    this.#conditions = input.conditions;
    this.#requirements = input.requirements;
  }

  async evaluate(
    context: WorkflowTransitionGateContext,
  ): Promise<WorkflowTransitionGateDecision> {
    const route = await this.#route.evaluate(context);
    if (!route.allowed) return route;

    const blockers: WorkflowGateBlocker[] = [];
    const trace = [...route.trace];

    if (context.fromStage !== undefined) {
      for (const condition of context.fromStage.exitConditions) {
        const result = await this.#conditions.evaluate({
          condition,
          context: {
            tenantId: context.instance.tenantId,
            instanceId: context.instance.instanceId,
            workTypeKey: context.instance.workTypeKey,
            stageKey: context.fromStage.stageKey,
            phase: 'EXIT',
          },
        });
        trace.push(`exit-condition:${condition.type}:${result.code}`);
        if (!result.satisfied) {
          blockers.push({
            kind: 'EXIT_CONDITION',
            code: result.code,
            key: condition.type,
          });
        }
      }

      const requiredKeys = uniqueNonEmpty(context.fromStage.blockingRequirementKeys);
      if (requiredKeys.length > 0) {
        const statuses = await this.#requirements.resolve({
          context: {
            tenantId: context.instance.tenantId,
            instanceId: context.instance.instanceId,
            workTypeKey: context.instance.workTypeKey,
            stageKey: context.fromStage.stageKey,
          },
          requirementKeys: requiredKeys,
        });
        const byKey = new Map(statuses.map((status) => [status.requirementKey, status]));
        for (const requirementKey of requiredKeys) {
          const status = byKey.get(requirementKey);
          if (status === undefined) {
            trace.push(`requirement:${requirementKey}:missing`);
            blockers.push({
              kind: 'REQUIREMENT',
              code: 'WORKFLOW_REQUIREMENT_STATUS_MISSING',
              key: requirementKey,
            });
            continue;
          }
          trace.push(`requirement:${requirementKey}:${status.code}`);
          if (isWorkflowRequirementBlocking(status)) {
            blockers.push({
              kind: 'REQUIREMENT',
              code: status.code,
              key: requirementKey,
            });
          }
        }
      }
    }

    for (const condition of context.toStage.entryConditions) {
      const result = await this.#conditions.evaluate({
        condition,
        context: {
          tenantId: context.instance.tenantId,
          instanceId: context.instance.instanceId,
          workTypeKey: context.instance.workTypeKey,
          stageKey: context.toStage.stageKey,
          phase: 'ENTRY',
        },
      });
      trace.push(`entry-condition:${condition.type}:${result.code}`);
      if (!result.satisfied) {
        blockers.push({
          kind: 'ENTRY_CONDITION',
          code: result.code,
          key: condition.type,
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
