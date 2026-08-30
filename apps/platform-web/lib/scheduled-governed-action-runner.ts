import type { PoolClient } from 'pg';
import {
  runScheduledGovernedActionWorkerOnce,
  type ScheduledGovernedActionWorkerResult,
} from './scheduled-governed-action-worker';

export interface ScheduledGovernedActionRunnerItemSummary {
  readonly index: number;
  readonly status: ScheduledGovernedActionWorkerResult['status'];
  readonly scheduledActionId: string | null;
  readonly childActionIntentId: string | null;
  readonly reasonCode: string | null;
}

export interface ScheduledGovernedActionRunnerSummary {
  readonly tenantId: string;
  readonly requestedLimit: number;
  readonly processed: number;
  readonly materialized: number;
  readonly staleClaim: number;
  readonly idle: boolean;
  readonly items: readonly ScheduledGovernedActionRunnerItemSummary[];
}

function positiveInteger(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('SCHEDULED_ACTION_RUNNER_LIMIT_INVALID');
  }
  return value;
}

export async function runScheduledGovernedActionWorkerBatch(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly limit: number;
    readonly now?: () => Date;
    readonly leaseMs?: number;
  },
): Promise<ScheduledGovernedActionRunnerSummary> {
  const limit = positiveInteger(input.limit);
  const items: ScheduledGovernedActionRunnerItemSummary[] = [];

  for (let index = 0; index < limit; index += 1) {
    const result = await runScheduledGovernedActionWorkerOnce(client, {
      tenantId: input.tenantId,
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.leaseMs === undefined ? {} : { leaseMs: input.leaseMs }),
    });

    if (result.status === 'IDLE') {
      items.push({
        index,
        status: 'IDLE',
        scheduledActionId: null,
        childActionIntentId: null,
        reasonCode: null,
      });
      break;
    }

    items.push({
      index,
      status: result.status,
      scheduledActionId: result.scheduled.scheduledActionId,
      childActionIntentId: result.childActionIntentId,
      reasonCode: result.reasonCode,
    });
  }

  return {
    tenantId: input.tenantId,
    requestedLimit: limit,
    processed: items.filter((item) => item.status !== 'IDLE').length,
    materialized: items.filter((item) => item.status === 'MATERIALIZED').length,
    staleClaim: items.filter((item) => item.status === 'STALE_CLAIM').length,
    idle: items.some((item) => item.status === 'IDLE'),
    items,
  };
}
