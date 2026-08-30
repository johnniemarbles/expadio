import {
  createDomainEvent,
  type DomainEventEnvelope,
  type DomainEventInput,
} from '@expadio/domain-events';

export interface DomainEventSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface DomainEventSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<DomainEventSqlResult<Row>>;
}

export interface DomainEventOutboxAppendInput {
  readonly event: DomainEventInput;
  readonly topic?: string;
  readonly partitionKey?: string;
}

export interface DomainEventOutboxAppendResult {
  readonly event: DomainEventEnvelope;
  readonly outboxId: string;
  readonly topic: string;
  readonly partitionKey: string;
}

function nonBlank(value: string | undefined, fallback: string, field: string): string {
  const candidate = value?.trim() || fallback.trim();
  if (candidate === '') throw new Error(`DOMAIN_EVENT_OUTBOX_${field.toUpperCase()}_REQUIRED`);
  return candidate;
}

/**
 * Append one immutable Domain Event and one mutable outbox delivery row.
 *
 * The caller must invoke this with the same PostgreSQL client and transaction
 * that owns the business mutation. This function intentionally does not open or
 * commit its own transaction: business state + event + outbox must succeed or
 * roll back as one atomic unit.
 */
export async function appendDomainEventWithOutbox(
  client: DomainEventSqlClient,
  input: DomainEventOutboxAppendInput,
): Promise<DomainEventOutboxAppendResult> {
  const event = createDomainEvent(input.event);
  const topic = nonBlank(input.topic, 'domain.events', 'topic');
  const partitionKey = nonBlank(
    input.partitionKey,
    `${event.aggregateType}:${event.aggregateId}`,
    'partition_key',
  );

  try {
    await client.query(
      `INSERT INTO platform.domain_events (
         event_id, tenant_id, aggregate_type, aggregate_id, event_type,
         event_version, occurred_at, recorded_at, actor_subject_id,
         correlation_id, causation_id, pack_key, pack_version, payload, metadata
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11, $12, $13, $14::jsonb, $15::jsonb
       )`,
      [
        event.eventId,
        event.tenantId,
        event.aggregateType,
        event.aggregateId,
        event.eventType,
        event.eventVersion,
        event.occurredAt,
        event.recordedAt,
        event.actorSubjectId,
        event.correlationId,
        event.causationId,
        event.packKey,
        event.packVersion,
        JSON.stringify(event.payload),
        JSON.stringify(event.metadata),
      ],
    );

    const outbox = await client.query<{ readonly outbox_id: string }>(
      `INSERT INTO platform.domain_event_outbox (
         tenant_id, event_id, topic, partition_key
       ) VALUES ($1::uuid, $2::uuid, $3, $4)
       RETURNING outbox_id`,
      [event.tenantId, event.eventId, topic, partitionKey],
    );
    const row = outbox.rows[0];
    if (row === undefined) throw new Error('DOMAIN_EVENT_OUTBOX_INSERT_FAILED');

    return {
      event,
      outboxId: row.outbox_id,
      topic,
      partitionKey,
    };
  } catch (error: any) {
    if (error?.code === '23505') {
      throw new Error('DOMAIN_EVENT_DUPLICATE');
    }
    throw error;
  }
}

interface DomainEventRow {
  readonly event_id: string;
  readonly tenant_id: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly event_type: string;
  readonly event_version: number;
  readonly occurred_at: Date | string;
  readonly recorded_at: Date | string;
  readonly actor_subject_id: string;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly pack_key: string | null;
  readonly pack_version: number | null;
  readonly payload: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
}

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export async function loadDomainEvent(
  client: DomainEventSqlClient,
  input: { readonly tenantId: string; readonly eventId: string },
): Promise<DomainEventEnvelope | null> {
  const result = await client.query<DomainEventRow>(
    `SELECT event_id, tenant_id, aggregate_type, aggregate_id, event_type,
            event_version, occurred_at, recorded_at, actor_subject_id,
            correlation_id, causation_id, pack_key, pack_version, payload, metadata
       FROM platform.domain_events
      WHERE tenant_id = $1::uuid
        AND event_id = $2::uuid`,
    [input.tenantId, input.eventId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;

  return {
    eventId: row.event_id,
    tenantId: row.tenant_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    occurredAt: date(row.occurred_at),
    recordedAt: date(row.recorded_at),
    actorSubjectId: row.actor_subject_id,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    packKey: row.pack_key,
    packVersion: row.pack_version,
    payload: row.payload,
    metadata: row.metadata,
  };
}
