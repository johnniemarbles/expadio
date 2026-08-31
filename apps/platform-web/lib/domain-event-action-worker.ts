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
import {
  evaluateLearningAssignmentRulesForLearner,
  type LearningAssignmentExecutionResult,
} from '@expadio/postgres-runtime/learning-assignment-automation';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';

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

async function evaluateLearningAssignmentsIfApplicable(
  client: PoolClient,
  claim: DomainEventOutboxClaim,
  now: Date,
): Promise<readonly LearningAssignmentExecutionResult[] | undefined> {
  if (
    claim.event.aggregateType === 'learning.learner'
    && claim.event.eventType === 'learning.learner.created'
  ) {
    // A learner-created event can outlive the tenant's commercial entitlement.
    // Consume it without assignments when Learning is no longer operational,
    // matching the governed-action suspension behavior below.
    const module = await loadTenantProductModule(client, {
      tenantId: claim.tenantId,
      moduleKey: 'learning',
    });
    if (module === null || module.availability !== 'ACTIVE') return [];

    // Assignment evaluation owns a transaction-scoped advisory lock. Commit the
    // idempotent assignment outcomes before horizontal side-effect executors
    // run; COMMUNICATE owns its own transaction boundary and must not be nested.
    //
    // If later materialization/execution fails, the Domain Event outbox retries.
    // Assignment execution rows and target-assignment checks make that retry
    // deterministic and duplicate-safe.
    await client.query('BEGIN');
    try {
      const learningAssignments =
        await evaluateLearningAssignmentRulesForLearner(client, {
          tenantId: claim.tenantId,
          learnerId: claim.event.aggregateId,
          actorSubjectId: 'system:learning-assignment-automation',
          correlationId: claim.event.correlationId,
          triggerEventId: claim.eventId,
          evaluatedAt: now,
        });
      await client.query('COMMIT');
      return learningAssignments;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  return undefined;
}

async function materializeActions(
  client: PoolClient,
  claim: DomainEventOutboxClaim,
  now: Date,
): Promise<readonly DomainEventGovernedActionResult[] | null> {
  if (claim.event.aggregateType === 'crm.case') {
    return materializeCrmCaseGovernedActionsForEvent(client, {
      tenantId: claim.tenantId,
      eventId: claim.eventId,
      now: () => now,
    });
  }

  if (claim.event.aggregateType.startsWith('learning.')) {
    return materializeLearningGovernedActionsForEvent(client, {
      tenantId: claim.tenantId,
      eventId: claim.eventId,
      now: () => now,
    });
  }

  return null;
}

async function completeClaim(
  client: PoolClient,
  claim: DomainEventOutboxClaim,
  now: Date,
): Promise<boolean> {
  return completeDomainEventOutbox(client, {
    tenantId: claim.tenantId,
    outboxId: claim.outboxId,
    claimedAt: claim.claimedAt,
    completedAt: now,
  });
}

/**
 * Process one tenant-scoped Domain Event outbox item.
 *
 * This is the composition boundary:
 * - outbox leasing/retry stays horizontal;
 * - learner-created assignment automation remains a Learning-domain concern;
 * - crm.case and Learning governed-action materializers provide aggregate data;
 * - task, communication, and schedule execution remain shared platform
 *   executors.
 *
 * No module-specific outbox, scheduler, task runner, or communication worker is
 * introduced here.
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
    const learningAssignments = await evaluateLearningAssignmentsIfApplicable(
      client,
      claim,
      now,
    );

    const materialized = await materializeActions(client, claim, now);
    if (materialized === null) {
      const completed = await completeClaim(client, claim, now);
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
        ...(learningAssignments === undefined ? {} : { learningAssignments }),
      };
    }

    const actions = materialized;
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
        communications.push(
          await executeGovernedCommunicateAction(client, {
            intent: action.intent,
            now: () => now.toISOString(),
          }),
        );
      } else if (action.intent.executorClass === 'SCHEDULE') {
        schedules.push(
          await executeGovernedScheduleAction(client, {
            intent: action.intent,
            now: () => now,
          }),
        );
      } else if (action.intent.executorClass === 'CREATE_TASK') {
        tasks.push(
          await executeGovernedCreateTaskAction(client, {
            intent: action.intent,
            now: () => now,
          }),
        );
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

    const completed = await completeClaim(client, claim, now);
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
      actions,
      communications,
      schedules,
      tasks,
      ...(learningAssignments === undefined ? {} : { learningAssignments }),
    };
  } catch (error) {
    return failClaim(
      client,
      claim,
      error instanceof Error
        ? error.message
        : 'Unknown domain event action worker failure',
      now,
      maxAttempts,
    );
  }
}
