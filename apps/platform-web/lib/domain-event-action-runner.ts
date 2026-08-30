import type { PoolClient } from 'pg';
import {
  processOneDomainEventActionWorkItem,
  type DomainEventActionWorkerResult,
} from './domain-event-action-worker';

export interface DomainEventActionRunnerItemSummary {
  readonly index: number;
  readonly status: DomainEventActionWorkerResult['status'];
  readonly eventId: string | null;
  readonly outboxId: string | null;
  readonly attempts: number | null;
  readonly actionCount: number;
  readonly communicationCount: number;
  readonly scheduleCount: number;
  readonly taskCount: number;
  readonly reason: string | null;
}

export interface DomainEventActionRunnerSummary {
  readonly tenantId: string;
  readonly requestedLimit: number;
  readonly processed: number;
  readonly idle: boolean;
  readonly published: number;
  readonly failed: number;
  readonly dead: number;
  readonly staleClaim: number;
  readonly errors: readonly DomainEventActionRunnerItemSummary[];
  readonly items: readonly DomainEventActionRunnerItemSummary[];
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field}_MUST_BE_POSITIVE_INTEGER`);
  }
  return value;
}

function summarizeItem(
  index: number,
  result: DomainEventActionWorkerResult,
): DomainEventActionRunnerItemSummary {
  if (result.status === 'IDLE') {
    return {
      index,
      status: 'IDLE',
      eventId: null,
      outboxId: null,
      attempts: null,
      actionCount: 0,
      communicationCount: 0,
      scheduleCount: 0,
      taskCount: 0,
      reason: null,
    };
  }

  return {
    index,
    status: result.status,
    eventId: result.claim.eventId,
    outboxId: result.claim.outboxId,
    attempts: result.claim.attempts,
    actionCount: result.status === 'PUBLISHED' ? result.actions.length : 0,
    communicationCount: result.status === 'PUBLISHED' ? result.communications.length : 0,
    scheduleCount: result.status === 'PUBLISHED' ? result.schedules.length : 0,
    taskCount: result.status === 'PUBLISHED' ? result.tasks.length : 0,
    reason: result.status === 'PUBLISHED' ? null : result.reason,
  };
}

/**
 * Process up to `limit` tenant-scoped Domain Event action work items.
 *
 * This is intentionally scheduler-neutral. A cron endpoint, admin action, or
 * future worker process can call this per tenant/tick and use the returned
 * metrics for observability without assuming a specific hosting runtime.
 */
export async function runDomainEventActionWorkerBatch(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly limit: number;
    readonly now?: () => Date;
    readonly leaseMs?: number;
    readonly maxAttempts?: number;
  },
): Promise<DomainEventActionRunnerSummary> {
  const limit = positiveInteger(input.limit, 'DOMAIN_EVENT_ACTION_RUNNER_LIMIT');
  const items: DomainEventActionRunnerItemSummary[] = [];

  for (let index = 0; index < limit; index += 1) {
    const result = await processOneDomainEventActionWorkItem(client, {
      tenantId: input.tenantId,
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.leaseMs === undefined ? {} : { leaseMs: input.leaseMs }),
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
    });
    const summary = summarizeItem(index, result);
    items.push(summary);
    if (result.status === 'IDLE') break;
  }

  const nonIdle = items.filter((item) => item.status !== 'IDLE');
  const errors = items.filter(
    (item) => item.status === 'FAILED' || item.status === 'DEAD' || item.status === 'STALE_CLAIM',
  );

  return {
    tenantId: input.tenantId,
    requestedLimit: limit,
    processed: nonIdle.length,
    idle: items.some((item) => item.status === 'IDLE'),
    published: items.filter((item) => item.status === 'PUBLISHED').length,
    failed: items.filter((item) => item.status === 'FAILED').length,
    dead: items.filter((item) => item.status === 'DEAD').length,
    staleClaim: items.filter((item) => item.status === 'STALE_CLAIM').length,
    errors,
    items,
  };
}
