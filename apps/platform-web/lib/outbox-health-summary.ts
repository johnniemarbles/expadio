import type { PoolClient } from 'pg';

export type OutboxHealthStatus = 'WATCH' | 'DEGRADED' | 'CRITICAL';

export type OutboxHealthKey =
  | 'domain_event_outbox_ready_backlog'
  | 'domain_event_outbox_retry_due'
  | 'domain_event_outbox_future_retry'
  | 'domain_event_outbox_stale_claims'
  | 'domain_event_outbox_dead';

export interface OutboxHealthSummaryEntry {
  readonly tenantId: string;
  readonly healthKey: OutboxHealthKey;
  readonly healthStatus: OutboxHealthStatus;
  readonly itemCount: number;
  readonly oldestAt: string | null;
  readonly newestAt: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface OutboxHealthSummaryRow {
  readonly tenant_id: string;
  readonly health_key: OutboxHealthKey;
  readonly health_status: OutboxHealthStatus;
  readonly item_count: number;
  readonly oldest_at: Date | string | null;
  readonly newest_at: Date | string | null;
  readonly metadata: Record<string, unknown>;
}

export interface OutboxHealthSummaryFilter {
  readonly tenantId: string;
  readonly healthKey?: OutboxHealthKey;
}

export const OUTBOX_HEALTH_KEYS: readonly OutboxHealthKey[] = [
  'domain_event_outbox_ready_backlog',
  'domain_event_outbox_retry_due',
  'domain_event_outbox_future_retry',
  'domain_event_outbox_stale_claims',
  'domain_event_outbox_dead',
] as const;

export function isOutboxHealthKey(value: string): value is OutboxHealthKey {
  return (OUTBOX_HEALTH_KEYS as readonly string[]).includes(value);
}

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapHealthRow(row: OutboxHealthSummaryRow): OutboxHealthSummaryEntry {
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

export async function listOutboxHealthSummary(
  client: PoolClient,
  filter: OutboxHealthSummaryFilter,
): Promise<OutboxHealthSummaryEntry[]> {
  const clauses: string[] = ['tenant_id = $1::uuid'];
  const params: unknown[] = [filter.tenantId];

  if (filter.healthKey !== undefined) {
    params.push(filter.healthKey);
    clauses.push(`health_key = $${params.length}`);
  }

  const result = await client.query<OutboxHealthSummaryRow>(
    `SELECT tenant_id, health_key, health_status, item_count,
            oldest_at, newest_at, metadata
       FROM platform.outbox_health_summary
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
