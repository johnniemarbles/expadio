import type { PoolClient } from 'pg';
import {
  claimDueScheduledGovernedAction,
  completeScheduledGovernedAction,
  retryOrFailScheduledGovernedAction,
  type PersistedScheduledGovernedAction,
} from '@expadio/postgres-runtime/scheduled-governed-action';
import {
  findGovernedActionIntentById,
  persistGovernedActionIntent,
} from '@expadio/postgres-runtime/governed-action-intent';
import {
  executeGovernedCommunicateAction,
  type GovernedCommunicateExecutionResult,
} from './governed-communicate-executor';

export type ScheduledGovernedActionWorkerResult =
  | { readonly status: 'IDLE' }
  | {
      readonly status: 'MATERIALIZED' | 'RETRY_SCHEDULED' | 'FAILED' | 'STALE_CLAIM';
      readonly scheduled: PersistedScheduledGovernedAction;
      readonly childActionIntentId: string | null;
      readonly communication: GovernedCommunicateExecutionResult | null;
      readonly reasonCode: string;
    };

export async function runScheduledGovernedActionWorkerOnce(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly now?: () => Date;
    readonly leaseMs?: number;
    readonly maxAttempts?: number;
  },
): Promise<ScheduledGovernedActionWorkerResult> {
  const now = input.now?.() ?? new Date();
  const scheduled = await claimDueScheduledGovernedAction(client, {
    tenantId: input.tenantId,
    now,
    ...(input.leaseMs === undefined ? {} : { leaseMs: input.leaseMs }),
  });
  if (scheduled === null) return { status: 'IDLE' };

  try {
    const parent = await findGovernedActionIntentById(client, {
      tenantId: scheduled.tenantId,
      actionIntentId: scheduled.parentActionIntentId,
    });
    if (parent === null) throw new Error('SCHEDULED_ACTION_PARENT_INTENT_NOT_FOUND');
    if (scheduled.targetExecutorClass !== 'COMMUNICATE') {
      throw new Error(`SCHEDULED_ACTION_EXECUTOR_NOT_IMPLEMENTED:${scheduled.targetExecutorClass}`);
    }

    const child = await persistGovernedActionIntent(client, {
    tenantId: parent.tenantId,
    sourceEventId: parent.sourceEventId,
    sourceEventType: parent.sourceEventType,
    aggregateType: parent.aggregateType,
    aggregateId: parent.aggregateId,
    ruleKey: `${parent.ruleKey}::scheduled::${scheduled.targetExecutorClass.toLowerCase()}`,
    executorClass: scheduled.targetExecutorClass,
    actionKey: scheduled.targetActionKey,
    idempotencyKey: scheduled.targetIdempotencyKey,
    correlationId: parent.correlationId,
    causationId: parent.actionIntentId,
    requestedBySubjectId: parent.requestedBySubjectId,
    requestedAt: scheduled.dueAt,
    configuration: {
      ...scheduled.targetConfiguration,
      scheduleParentActionIntentId: parent.actionIntentId,
      scheduledActionId: scheduled.scheduledActionId,
      scheduledFor: scheduled.dueAt.toISOString(),
    },
    policyDecision: {
      allowed: true,
      policyKeys: [...parent.policyDecision.policyKeys],
      evidenceRefs: [
        ...parent.policyDecision.evidenceRefs,
        `schedule:${scheduled.scheduledActionId}`,
      ],
      reasonCode: 'SCHEDULE_DUE_MATERIALIZATION',
      evaluatedAt: now,
    },
  });

    const communication = await executeGovernedCommunicateAction(client, {
      intent: child,
      now: () => (input.now?.() ?? new Date()).toISOString(),
    });

    const completed = await completeScheduledGovernedAction(client, {
      scheduled,
      childActionIntentId: child.actionIntentId,
      completedAt: input.now?.() ?? new Date(),
    });

    return {
      status: completed ? 'MATERIALIZED' : 'STALE_CLAIM',
      scheduled,
      childActionIntentId: completed ? child.actionIntentId : null,
      communication,
      reasonCode: completed ? 'CHILD_ACTION_MATERIALIZED' : 'SCHEDULE_CLAIM_LOST',
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown scheduled action execution failure.';
    const status = await retryOrFailScheduledGovernedAction(client, {
      scheduled,
      failedAt: input.now?.() ?? new Date(),
      maxAttempts: input.maxAttempts ?? 8,
      reasonCode: 'SCHEDULED_ACTION_EXECUTION_FAILED',
      reason,
    });
    return {
      status,
      scheduled,
      childActionIntentId: null,
      communication: null,
      reasonCode: status === 'FAILED'
        ? 'SCHEDULED_ACTION_RETRIES_EXHAUSTED'
        : status === 'STALE_CLAIM'
          ? 'SCHEDULE_CLAIM_LOST'
          : 'SCHEDULED_ACTION_EXECUTION_FAILED',
    };
  }
}
