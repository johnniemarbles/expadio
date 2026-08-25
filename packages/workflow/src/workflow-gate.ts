import type {
  InstantiatedWorkflowBlueprint,
  WorkflowInstance,
  WorkflowStageDefinition,
  WorkflowTransitionIntent,
} from './index.ts';

export type WorkflowGateBlockerKind =
  | 'ROUTE'
  | 'ENTRY_CONDITION'
  | 'EXIT_CONDITION'
  | 'REQUIREMENT'
  | 'DECISION'
  | 'APPROVAL'
  | 'PARTICIPANT'
  | 'ASSIGNMENT'
  | 'HOLD'
  | 'AUTHORIZATION'
  | 'POLICY';

export interface WorkflowGateBlocker {
  readonly kind: WorkflowGateBlockerKind;
  readonly code: string;
  readonly key?: string;
  readonly message?: string;
}

export interface WorkflowTransitionGateContext {
  readonly instance: WorkflowInstance;
  readonly blueprint: InstantiatedWorkflowBlueprint;
  readonly intent: WorkflowTransitionIntent;
  readonly fromStage?: WorkflowStageDefinition;
  readonly toStage: WorkflowStageDefinition;
}

export interface WorkflowTransitionGateDecision {
  readonly allowed: boolean;
  readonly blockers: readonly WorkflowGateBlocker[];
  /** Ordered, implementation-neutral evidence of which checks were evaluated. */
  readonly trace: readonly string[];
}

/**
 * Evaluates whether an otherwise structurally valid workflow stage move may be
 * committed. Concrete requirement, approval, assignment and policy engines are
 * injected later; this contract keeps the workflow runtime independent from
 * any one vertical or framework.
 */
export interface WorkflowTransitionGateEvaluator {
  evaluate(
    context: WorkflowTransitionGateContext,
  ): Promise<WorkflowTransitionGateDecision>;
}

export function allowedWorkflowGateDecision(
  trace: readonly string[] = [],
): WorkflowTransitionGateDecision {
  return { allowed: true, blockers: [], trace: [...trace] };
}

export function blockedWorkflowGateDecision(input: {
  readonly blockers: readonly WorkflowGateBlocker[];
  readonly trace?: readonly string[];
}): WorkflowTransitionGateDecision {
  if (input.blockers.length === 0) {
    throw new Error('WORKFLOW_GATE_BLOCKERS_REQUIRED');
  }
  return {
    allowed: false,
    blockers: [...input.blockers],
    trace: [...(input.trace ?? [])],
  };
}
