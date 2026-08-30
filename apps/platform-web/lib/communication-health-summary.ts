import type { PoolClient } from 'pg';

export type CommunicationHealthStatus = 'WATCH' | 'DEGRADED' | 'CRITICAL';

export type CommunicationHealthKey =
  | 'communication_deliveries_in_flight'
  | 'communication_deliveries_negative_terminal'
  | 'communication_provider_attempt_failures'
  | 'communication_provider_webhooks_negative'
  | 'communication_provider_webhooks_unmatched';

export interface CommunicationHealthSummaryEntry {
  readonly tenantId: string;
  readonly healthKey: CommunicationHealthKey;
  readonly healthStatus: CommunicationHealthStatus;
  readonly itemCount: number;
  readonly oldestAt: string | null;
  readonly newestAt: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface CommunicationHealthSummaryRow {
  readonly tenant_id: string;
  readonly health_key: CommunicationHealthKey;
  readonly health_status: CommunicationHealthStatus;
  readonly item_count: number;
  readonly oldest_at: Date | string | null;
  readonly newest_at: Date | string | null;
  readonly metadata: Record<string, unknown>;
}

export interface CommunicationHealthSummaryFilter {
  readonly tenantId: string;
  readonly healthKey?: CommunicationHealthKey;
}

export const COMMUNICATION_HEALTH_KEYS: readonly CommunicationHealthKey[] = [
  'communication_deliveries_in_flight',
  'communication_deliveries_negative_terminal',
  'communication_provider_attempt_failures',
  'communication_provider_webhooks_negative',
  'communication_provider_webhooks_unmatched',
] as const;

export function isCommunicationHealthKey(value: string): value is CommunicationHealthKey {
  return (COMMUNICATION_HEALTH_KEYS as readonly string[]).includes(value);
}

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapHealthRow(row: CommunicationHealthSummaryRow): CommunicationHealthSummaryEntry {
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

export async function listCommunicationHealthSummary(
  client: PoolClient,
  filter: CommunicationHealthSummaryFilter,
): Promise<CommunicationHealthSummaryEntry[]> {
  const clauses: string[] = ['tenant_id = $1::uuid'];
  const params: unknown[] = [filter.tenantId];

  if (filter.healthKey !== undefined) {
    params.push(filter.healthKey);
    clauses.push(`health_key = $${params.length}`);
  }

  const result = await client.query<CommunicationHealthSummaryRow>(
    `SELECT tenant_id, health_key, health_status, item_count,
            oldest_at, newest_at, metadata
       FROM platform.communication_health_summary
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
