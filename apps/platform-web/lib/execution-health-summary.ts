import type { PoolClient } from 'pg';

export type ExecutionHealthStatus = 'WATCH' | 'DEGRADED' | 'CRITICAL';

export type ExecutionHealthKey =
  | 'domain_event_outbox_unpublished'
  | 'governed_action_failed_attempts'
  | 'scheduled_actions_due_unmaterialized'
  | 'communication_deliveries_open'
  | 'communication_provider_webhooks_unmatched';

export interface ExecutionHealthSummaryEntry {
  readonly tenantId: string;
  readonly healthKey: ExecutionHealthKey;
  readonly healthStatus: ExecutionHealthStatus;
  readonly itemCount: number;
  readonly oldestAt: string | null;
  readonly newestAt: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface ExecutionHealthSummaryRow {
  readonly tenant_id: string;
  readonly health_key: ExecutionHealthKey;
  readonly health_status: ExecutionHealthStatus;
  readonly item_count: number;
  readonly oldest_at: Date | string | null;
  readonly newest_at: Date | string | null;
  readonly metadata: Record<string, unknown>;
}

export interface ExecutionHealthSummaryFilter {
  readonly tenantId: string;
  readonly healthKey?: ExecutionHealthKey;
}

export const EXECUTION_HEALTH_KEYS: readonly ExecutionHealthKey[] = [
  'domain_event_outbox_unpublished',
  'governed_action_failed_attempts',
  'scheduled_actions_due_unmaterialized',
  'communication_deliveries_open',
  'communication_provider_webhooks_unmatched',
] as const;

export function isExecutionHealthKey(value: string): value is ExecutionHealthKey {
  return (EXECUTION_HEALTH_KEYS as readonly string[]).includes(value);
}

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapHealthRow(row: ExecutionHealthSummaryRow): ExecutionHealthSummaryEntry {
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

export async function listExecutionHealthSummary(
  client: PoolClient,
  filter: ExecutionHealthSummaryFilter,
): Promise<ExecutionHealthSummaryEntry[]> {
  const clauses: string[] = ['tenant_id = $1::uuid'];
  const params: unknown[] = [filter.tenantId];

  if (filter.healthKey !== undefined) {
    params.push(filter.healthKey);
    clauses.push(`health_key = $${params.length}`);
  }

  const result = await client.query<ExecutionHealthSummaryRow>(
    `SELECT tenant_id, health_key, health_status, item_count,
            oldest_at, newest_at, metadata
       FROM platform.execution_health_summary
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
