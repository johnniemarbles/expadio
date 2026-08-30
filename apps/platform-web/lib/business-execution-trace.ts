import type { PoolClient } from 'pg';

export type BusinessExecutionTraceKind =
  | 'DOMAIN_EVENT'
  | 'DOMAIN_EVENT_OUTBOX'
  | 'GOVERNED_ACTION'
  | 'GOVERNED_ACTION_ATTEMPT'
  | 'SCHEDULED_ACTION'
  | 'COMMUNICATION_DELIVERY'
  | 'COMMUNICATION_PROVIDER_ATTEMPT'
  | 'OPERATIONAL_TASK';

export interface BusinessExecutionTraceEntry {
  readonly traceKind: BusinessExecutionTraceKind;
  readonly traceId: string;
  readonly parentTraceId: string | null;
  readonly tenantId: string;
  readonly rootEventId: string;
  readonly correlationId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly sourceEventType: string | null;
  readonly actionIntentId: string | null;
  readonly executorClass: string | null;
  readonly actionKey: string | null;
  readonly state: string | null;
  readonly reasonCode: string | null;
  readonly occurredAt: string;
  readonly summary: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface BusinessExecutionTraceRow {
  readonly trace_kind: BusinessExecutionTraceKind;
  readonly trace_id: string;
  readonly parent_trace_id: string | null;
  readonly tenant_id: string;
  readonly root_event_id: string;
  readonly correlation_id: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly source_event_type: string | null;
  readonly action_intent_id: string | null;
  readonly executor_class: string | null;
  readonly action_key: string | null;
  readonly state: string | null;
  readonly reason_code: string | null;
  readonly occurred_at: Date | string;
  readonly summary: string;
  readonly metadata: Record<string, unknown>;
}

export interface BusinessExecutionTraceFilter {
  readonly tenantId: string;
  readonly rootEventId?: string;
  readonly correlationId?: string;
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  readonly limit?: number;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapTraceRow(row: BusinessExecutionTraceRow): BusinessExecutionTraceEntry {
  return {
    traceKind: row.trace_kind,
    traceId: row.trace_id,
    parentTraceId: row.parent_trace_id,
    tenantId: row.tenant_id,
    rootEventId: row.root_event_id,
    correlationId: row.correlation_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    sourceEventType: row.source_event_type,
    actionIntentId: row.action_intent_id,
    executorClass: row.executor_class,
    actionKey: row.action_key,
    state: row.state,
    reasonCode: row.reason_code,
    occurredAt: asIso(row.occurred_at),
    summary: row.summary,
    metadata: row.metadata,
  };
}

export async function listBusinessExecutionTrace(
  client: PoolClient,
  filter: BusinessExecutionTraceFilter,
): Promise<BusinessExecutionTraceEntry[]> {
  const clauses: string[] = ['tenant_id = $1::uuid'];
  const params: unknown[] = [filter.tenantId];

  if (filter.rootEventId !== undefined) {
    params.push(filter.rootEventId);
    clauses.push(`root_event_id = $${params.length}::uuid`);
  }
  if (filter.correlationId !== undefined) {
    params.push(filter.correlationId);
    clauses.push(`correlation_id = $${params.length}`);
  }
  if (filter.aggregateType !== undefined) {
    params.push(filter.aggregateType);
    clauses.push(`aggregate_type = $${params.length}`);
  }
  if (filter.aggregateId !== undefined) {
    params.push(filter.aggregateId);
    clauses.push(`aggregate_id = $${params.length}`);
  }

  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 200);
  params.push(limit);

  const result = await client.query<BusinessExecutionTraceRow>(
    `SELECT
       trace_kind, trace_id, parent_trace_id, tenant_id, root_event_id,
       correlation_id, aggregate_type, aggregate_id,
       root_event_type AS source_event_type,
       NULLIF(metadata ->> 'actionIntentId', '') AS action_intent_id,
       executor_class, action_key, state, reason_code,
       trace_at AS occurred_at, summary, metadata
     FROM platform.business_execution_trace
     WHERE ${clauses.join(' AND ')}
     ORDER BY trace_at, trace_kind, trace_id
     LIMIT ${params.length}`,
    params,
  );

  return result.rows.map(mapTraceRow);
}
