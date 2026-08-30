import type { PoolClient } from 'pg';
import {
  claimDueScheduledGovernedAction,
  completeScheduledGovernedAction,
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
      readonly status: 'MATERIALIZED' | 'STALE_CLAIM';
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
  },
): Promise<ScheduledGovernedActionWorkerResult> {
  const now = input.now?.() ?? new Date();
  const scheduled = await claimDueScheduledGovernedAction(client, {
    tenantId: input.tenantId,
    now,
    ...(input.leaseMs === undefined ? {} : { leaseMs: input.leaseMs }),
  });
  if (scheduled === null) return { status: 'IDLE' };

  const parent = await findGovernedActionIntentById(client, {
    tenantId: scheduled.tenantId,
    actionIntentId: scheduled.parentActionIntentId,
  });
  if (parent === null) throw new Error('SCHEDULED_ACTION_PARENT_INTENT_NOT_FOUND');

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

  let communication: GovernedCommunicateExecutionResult | null = null;
  if (child.executorClass === 'COMMUNICATE') {
    communication = await executeGovernedCommunicateAction(client, {
      intent: child,
      now: () => (input.now?.() ?? new Date()).toISOString(),
    });
  }

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
}
