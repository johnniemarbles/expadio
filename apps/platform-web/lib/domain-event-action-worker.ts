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
  materializeLearningGovernedActionsForEvent,
  type LearningGovernedActionResult,
} from './learning-governed-actions';
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

export type DomainEventGovernedActionResult =
  | CrmCaseGovernedActionResult
  | LearningGovernedActionResult;

export type DomainEventActionWorkerResult =
  | { readonly status: 'IDLE' }
  | {
      readonly status: 'PUBLISHED';
      readonly claim: DomainEventOutboxClaim;
      readonly actions: readonly DomainEventGovernedActionResult[];
      readonly communications: readonly GovernedCommunicateExecutionResult[];
      readonly schedules: readonly GovernedScheduleExecutionResult[];
      readonly tasks: readonly GovernedCreateTaskExecutionResult[];
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
 * aggregate-specific materialization stays in the application layer while
 * executor classes remain horizontal. crm.case and Learning events therefore
 * share one leased outbox worker and the same governed execution runtimes.
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
    let actions: readonly DomainEventGovernedActionResult[];
    if (claim.event.aggregateType === 'crm.case') {
      actions = await materializeCrmCaseGovernedActionsForEvent(client, {
        tenantId: claim.tenantId,
        eventId: claim.eventId,
        now: () => now,
      });
    } else if (claim.event.aggregateType.startsWith('learning.')) {
      actions = await materializeLearningGovernedActionsForEvent(client, {
        tenantId: claim.tenantId,
        eventId: claim.eventId,
        now: () => now,
      });
    } else {
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
      };
    }

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
