import type { PoolClient } from 'pg';

export type SchedulerHealthStatus = 'WATCH' | 'DEGRADED' | 'CRITICAL';

export type SchedulerHealthKey =
  | 'scheduler_targets_due'
  | 'scheduler_targets_disabled'
  | 'scheduler_execution_expired_leases'
  | 'scheduler_execution_failed_runs'
  | 'scheduler_scheduled_actions_due_unmaterialized';

export interface SchedulerHealthSummaryEntry {
  readonly tenantId: string;
  readonly healthKey: SchedulerHealthKey;
  readonly healthStatus: SchedulerHealthStatus;
  readonly itemCount: number;
  readonly oldestAt: string | null;
  readonly newestAt: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface SchedulerHealthSummaryRow {
  readonly tenant_id: string;
  readonly health_key: SchedulerHealthKey;
  readonly health_status: SchedulerHealthStatus;
  readonly item_count: number;
  readonly oldest_at: Date | string | null;
  readonly newest_at: Date | string | null;
  readonly metadata: Record<string, unknown>;
}

export interface SchedulerHealthSummaryFilter {
  readonly tenantId: string;
  readonly healthKey?: SchedulerHealthKey;
}

export const SCHEDULER_HEALTH_KEYS: readonly SchedulerHealthKey[] = [
  'scheduler_targets_due',
  'scheduler_targets_disabled',
  'scheduler_execution_expired_leases',
  'scheduler_execution_failed_runs',
  'scheduler_scheduled_actions_due_unmaterialized',
] as const;

export function isSchedulerHealthKey(value: string): value is SchedulerHealthKey {
  return (SCHEDULER_HEALTH_KEYS as readonly string[]).includes(value);
}

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapHealthRow(row: SchedulerHealthSummaryRow): SchedulerHealthSummaryEntry {
  return {
    tenantId: row.tenant_id,
    healthKey: row.health_key,
    healthStatus: row.health_status,
    itemCount: row.item_count,
    oldestAt: asIso(row.oldest_at),
    newestAt: asIso(row.newest_at),
    metadata: row.metadata,
  };
}

export async function listSchedulerHealthSummary(
  client: PoolClient,
  filter: SchedulerHealthSummaryFilter,
): Promise<SchedulerHealthSummaryEntry[]> {
  const clauses: string[] = ['tenant_id = $1::uuid'];
  const params: unknown[] = [filter.tenantId];

  if (filter.healthKey !== undefined) {
    params.push(filter.healthKey);
    clauses.push(`health_key = $${params.length}`);
  }

  const result = await client.query<SchedulerHealthSummaryRow>(
    `SELECT tenant_id, health_key, health_status, item_count,
            oldest_at, newest_at, metadata
       FROM platform.scheduler_health_summary
      WHERE ${clauses.join(' AND ')}
      ORDER BY CASE health_status
                 WHEN 'CRITICAL' THEN 1
                 WHEN 'DEGRADED' THEN 2
                 ELSE 3
               END,
               oldest_at NULLS LAST,
               health_key`,
    params,
  );

  return result.rows.map(mapHealthRow);
}
