import type { GovernedActionExecutorClass } from './index.ts';

export type GovernedActionExecutionStatus =
  | 'QUEUED'
  | 'SUCCEEDED'
  | 'REFUSED'
  | 'FAILED'
  | 'RETRYABLE';

export interface GovernedActionExecutionAttempt {
  readonly tenantId: string;
  readonly actionIntentId: string;
  readonly executorClass: GovernedActionExecutorClass;
  readonly attemptKey: string;
  readonly status: GovernedActionExecutionStatus;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly reasonCode: string;
  readonly reason: string | null;
  readonly outputReference: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface PersistedGovernedActionExecutionAttempt
  extends GovernedActionExecutionAttempt {
  readonly executionAttemptId: string;
  readonly createdAt: Date;
}

export function governedActionExecutionAttemptKey(input: {
  readonly actionIntentId: string;
  readonly phase: string;
}): string {
  const intentId = input.actionIntentId.trim();
  const phase = input.phase.trim();
  if (intentId === '') throw new Error('GOVERNED_ACTION_EXECUTION_INTENT_ID_REQUIRED');
  if (phase === '') throw new Error('GOVERNED_ACTION_EXECUTION_PHASE_REQUIRED');
  return `${intentId}:${phase}`;
}
