import type { PoolClient } from 'pg';
import {
  claimDomainEventOutbox,
  completeDomainEventOutbox,
  failDomainEventOutbox,
  type DomainEventOutboxClaim,
} from '@expadio/postgres-runtime/domain-event-outbox-worker';
import {
  materializeCrmCaseGovernedActionsForEvent,
  type CrmCaseGovernedActionResult,
} from './crm-case-governed-actions';
import {
  executeGovernedCommunicateAction,
  type GovernedCommunicateExecutionResult,
} from './governed-communicate-executor';
import {
  executeGovernedScheduleAction,
  type GovernedScheduleExecutionResult,
} from './governed-schedule-executor';
import {
  executeGovernedCreateTaskAction,
  type GovernedCreateTaskExecutionResult,
} from './governed-create-task-executor';
import {
  evaluateLearningAssignmentRulesForLearner,
  type LearningAssignmentExecutionResult,
} from '@expadio/postgres-runtime/learning-assignment-automation';

export type DomainEventActionWorkerResult =
  | { readonly status: 'IDLE' }
  | {
      readonly status: 'PUBLISHED';
      readonly claim: DomainEventOutboxClaim;
      readonly actions: readonly CrmCaseGovernedActionResult[];
      readonly communications: readonly GovernedCommunicateExecutionResult[];
      readonly schedules: readonly GovernedScheduleExecutionResult[];
      readonly tasks: readonly GovernedCreateTaskExecutionResult[];
      readonly learningAssignments?: readonly LearningAssignmentExecutionResult[];
    }
  | {
      readonly status: 'FAILED' | 'DEAD' | 'STALE_CLAIM';
      readonly claim: DomainEventOutboxClaim;
      readonly reason: string;
    };

function retryAt(now: Date, attempts: number): Date {
  const delayMs = Math.min(15 * 60_000, 30_000 * Math.max(1, attempts));
  return new Date(now.getTime() + delayMs);
}

async function failClaim(
  client: PoolClient,
  claim: DomainEventOutboxClaim,
  reason: string,
  now: Date,
  maxAttempts: number,
): Promise<DomainEventActionWorkerResult> {
  const status = await failDomainEventOutbox(client, {
    tenantId: claim.tenantId,
    outboxId: claim.outboxId,
    claimedAt: claim.claimedAt,
    error: reason,
    failedAt: now,
    retryAt: retryAt(now, claim.attempts),
    maxAttempts,
  });
  return { status, claim, reason };
}

/**
 * Process one tenant-scoped Domain Event outbox item.
 *
 * This is the composition boundary: generic outbox leasing remains horizontal;
 * crm.case materialization and COMMUNICATE execution stay in the application
 * layer where the relevant aggregate context and communication runtime exist.
 */
export async function processOneDomainEventActionWorkItem(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly now?: () => Date;
    readonly leaseMs?: number;
    readonly maxAttempts?: number;
  },
): Promise<DomainEventActionWorkerResult> {
  const now = input.now?.() ?? new Date();
  const maxAttempts = input.maxAttempts ?? 8;
  const claim = await claimDomainEventOutbox(client, {
    tenantId: input.tenantId,
    now,
    ...(input.leaseMs === undefined ? {} : { leaseMs: input.leaseMs }),
    maxAttempts,
  });
  if (claim === null) return { status: 'IDLE' };

  try {
    if (
      claim.event.aggregateType === 'learning.learner'
      && claim.event.eventType === 'learning.learner.created'
    ) {
      const learningAssignments = await evaluateLearningAssignmentRulesForLearner(
        client,
        {
          tenantId: claim.tenantId,
          learnerId: claim.event.aggregateId,
          actorSubjectId: 'system:learning-assignment-automation',
          correlationId: claim.event.correlationId,
          triggerEventId: claim.eventId,
          evaluatedAt: now,
        },
      );

      const completed = await completeDomainEventOutbox(client, {
        tenantId: claim.tenantId,
        outboxId: claim.outboxId,
        claimedAt: claim.claimedAt,
        completedAt: now,
      });
      if (!completed) {
        return {
          status: 'STALE_CLAIM',
          claim,
          reason: 'Claim was superseded before completion.',
        };
      }
      return {
        status: 'PUBLISHED',
        claim,
        actions: [],
        communications: [],
        schedules: [],
        tasks: [],
        learningAssignments,
      };
    }

    if (claim.event.aggregateType !== 'crm.case') {
      const completed = await completeDomainEventOutbox(client, {
        tenantId: claim.tenantId,
        outboxId: claim.outboxId,
        claimedAt: claim.claimedAt,
        completedAt: now,
      });
      if (!completed) return { status: 'STALE_CLAIM', claim, reason: 'Claim was superseded before completion.' };
      return { status: 'PUBLISHED', claim, actions: [], communications: [], schedules: [], tasks: [] };
    }

    const actions = await materializeCrmCaseGovernedActionsForEvent(client, {
      tenantId: claim.tenantId,
      eventId: claim.eventId,
      now: () => now,
    });

    const skipped = actions.find((action) => action.status === 'SKIPPED');
    if (skipped !== undefined) {
      return failClaim(
        client,
        claim,
        `${skipped.ruleKey}:${skipped.reasonCode}:${skipped.reason}`,
        now,
        maxAttempts,
      );
    }

    const communications: GovernedCommunicateExecutionResult[] = [];
    const schedules: GovernedScheduleExecutionResult[] = [];
    const tasks: GovernedCreateTaskExecutionResult[] = [];
    for (const action of actions) {
      if (action.status !== 'PERSISTED') continue;
      if (action.intent.executorClass === 'COMMUNICATE') {
        communications.push(await executeGovernedCommunicateAction(client, {
          intent: action.intent,
          now: () => now.toISOString(),
        }));
      } else if (action.intent.executorClass === 'SCHEDULE') {
        schedules.push(await executeGovernedScheduleAction(client, {
          intent: action.intent,
          now: () => now,
        }));
      } else if (action.intent.executorClass === 'CREATE_TASK') {
        tasks.push(await executeGovernedCreateTaskAction(client, {
          intent: action.intent,
          now: () => now,
        }));
      } else {
        return failClaim(
          client,
          claim,
          `${action.ruleKey}:EXECUTOR_NOT_IMPLEMENTED:${action.intent.executorClass}`,
          now,
          maxAttempts,
        );
      }
    }

    const completed = await completeDomainEventOutbox(client, {
      tenantId: claim.tenantId,
      outboxId: claim.outboxId,
      claimedAt: claim.claimedAt,
      completedAt: now,
    });
    if (!completed) return { status: 'STALE_CLAIM', claim, reason: 'Claim was superseded before completion.' };

    return {
      status: 'PUBLISHED',
      claim,
      actions,
      communications,
      schedules,
      tasks,
    };
  } catch (error) {
    return failClaim(
      client,
      claim,
      error instanceof Error ? error.message : 'Unknown domain event action worker failure',
      now,
      maxAttempts,
    );
  }
}
