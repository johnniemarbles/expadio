import {
  allowedWorkflowGateDecision,
  blockedWorkflowGateDecision,
  type WorkflowTransitionGateContext,
  type WorkflowTransitionGateDecision,
  type WorkflowTransitionGateEvaluator,
} from './workflow-gate.ts';
import type { WorkflowTransitionAuthorizationProvider } from './workflow-authorization.ts';

export class WorkflowAuthorizationGateEvaluator
  implements WorkflowTransitionGateEvaluator {
  readonly #authorization: WorkflowTransitionAuthorizationProvider;
  readonly #action: string;

  constructor(input: {
    readonly authorization: WorkflowTransitionAuthorizationProvider;
    readonly action?: string;
  }) {
    this.#authorization = input.authorization;
    this.#action = input.action ?? 'workflow.transition';
  }

  async evaluate(
    context: WorkflowTransitionGateContext,
  ): Promise<WorkflowTransitionGateDecision> {
    const decision = await this.#authorization.authorize({
      tenantId: context.instance.tenantId,
      instanceId: context.instance.instanceId,
      workTypeKey: context.instance.workTypeKey,
      actorSubjectId: context.intent.requestedBySubjectId,
      ...(context.fromStage === undefined ? {} : { fromStageKey: context.fromStage.stageKey }),
      toStageKey: context.toStage.stageKey,
      action: this.#action,
    });

    const trace = [`authorization:${decision.code}`];
    return decision.allowed
      ? allowedWorkflowGateDecision(trace)
      : blockedWorkflowGateDecision({
          blockers: [{
            kind: 'AUTHORIZATION',
            code: decision.code,
            key: this.#action,
          }],
          trace,
        });
  }
}
