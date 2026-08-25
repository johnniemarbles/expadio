import type { WorkflowCondition } from './index.ts';

export type WorkflowConditionPhase = 'ENTRY' | 'EXIT';

export interface WorkflowConditionEvaluationContext {
  readonly tenantId: string;
  readonly instanceId: string;
  readonly workTypeKey: string;
  readonly stageKey: string;
  readonly phase: WorkflowConditionPhase;
}

export interface WorkflowConditionEvaluationResult {
  readonly satisfied: boolean;
  /** Stable machine-readable result code; never use free text for policy flow. */
  readonly code: string;
  /** Opaque references to auditable source evidence, not raw sensitive values. */
  readonly evidenceRefs: readonly string[];
}

/**
 * Evaluates one blueprint-declared condition against authorized business
 * context. Implementations may query domain facts through injected ports, but
 * the universal workflow package never depends on vertical schemas.
 */
export interface WorkflowConditionEvaluator {
  evaluate(input: {
    readonly condition: WorkflowCondition;
    readonly context: WorkflowConditionEvaluationContext;
  }): Promise<WorkflowConditionEvaluationResult>;
}
