import type { PoolClient } from 'pg';

export const DOMAIN_EVENT_OPERATION_STATUSES = [
  'PENDING',
  'CLAIMED',
  'FAILED',
  'DEAD',
  'PUBLISHED',
] as const;

export type DomainEventOperationStatus =
  (typeof DOMAIN_EVENT_OPERATION_STATUSES)[number];

export interface DomainEventOperationItem {
  readonly outboxId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly status: DomainEventOperationStatus;
  readonly attempts: number;
  readonly availableAt: string;
  readonly claimedAt: string | null;
  readonly publishedAt: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
}

interface OperationRow {
  readonly outbox_id: string;
  readonly event_id: string;
  readonly event_type: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly status: DomainEventOperationStatus;
  readonly attempts: number;
  readonly available_at: Date | string;
  readonly claimed_at: Date | string | null;
  readonly published_at: Date | string | null;
  readonly last_error: string | null;
  readonly created_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoNullable(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function mapRow(row: OperationRow): DomainEventOperationItem {
  return {
    outboxId: row.outbox_id,
    eventId: row.event_id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    status: row.status,
    attempts: row.attempts,
    availableAt: iso(row.available_at),
    claimedAt: isoNullable(row.claimed_at),
    publishedAt: isoNullable(row.published_at),
    lastError: row.last_error,
    createdAt: iso(row.created_at),
  };
}


export async function loadDomainEventOperationById(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly outboxId: string;
  },
): Promise<DomainEventOperationItem | null> {
  const result = await client.query<OperationRow>(
    `SELECT outbox.outbox_id,
            outbox.event_id,
            event.event_type,
            event.aggregate_type,
            event.aggregate_id,
            outbox.status,
            outbox.attempts,
            outbox.available_at,
            outbox.claimed_at,
            outbox.published_at,
            outbox.last_error,
            outbox.created_at
       FROM platform.domain_event_outbox outbox
       JOIN platform.domain_events event
         ON event.tenant_id = outbox.tenant_id
        AND event.event_id = outbox.event_id
      WHERE outbox.tenant_id = $1::uuid
        AND outbox.outbox_id = $2::uuid
      LIMIT 1`,
    [input.tenantId, input.outboxId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapRow(row);
}

export async function loadDomainEventOperations(
  client: PoolClient,
  input: {
    readonly status?: DomainEventOperationStatus;
    readonly limit?: number;
  } = {},
): Promise<readonly DomainEventOperationItem[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 200));
  const result = await client.query<OperationRow>(
    `SELECT outbox.outbox_id,
            outbox.event_id,
            event.event_type,
            event.aggregate_type,
            event.aggregate_id,
            outbox.status,
            outbox.attempts,
            outbox.available_at,
            outbox.claimed_at,
            outbox.published_at,
            outbox.last_error,
            outbox.created_at
       FROM platform.domain_event_outbox outbox
       JOIN platform.domain_events event
         ON event.tenant_id = outbox.tenant_id
        AND event.event_id = outbox.event_id
      WHERE ($1::text IS NULL OR outbox.status = $1)
      ORDER BY
        CASE outbox.status
          WHEN 'DEAD' THEN 0
          WHEN 'FAILED' THEN 1
          WHEN 'CLAIMED' THEN 2
          WHEN 'PENDING' THEN 3
          ELSE 4
        END,
        outbox.updated_at DESC,
        outbox.outbox_id
      LIMIT $2`,
    [input.status ?? null, limit],
  );
  return result.rows.map(mapRow);
}

export interface DomainEventOperationCounts {
  readonly total: number;
  readonly dead: number;
  readonly failed: number;
  readonly claimed: number;
  readonly pending: number;
  readonly published: number;
}

export async function loadDomainEventOperationCounts(
  client: PoolClient,
): Promise<DomainEventOperationCounts> {
  const result = await client.query<{
    readonly total: number;
    readonly dead: number;
    readonly failed: number;
    readonly claimed: number;
    readonly pending: number;
    readonly published: number;
  }>(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE status = 'DEAD')::int AS dead,
       count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
       count(*) FILTER (WHERE status = 'CLAIMED')::int AS claimed,
       count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
       count(*) FILTER (WHERE status = 'PUBLISHED')::int AS published
       FROM platform.domain_event_outbox`,
  );
  return result.rows[0] ?? {
    total: 0,
    dead: 0,
    failed: 0,
    claimed: 0,
    pending: 0,
    published: 0,
  };
}

export interface RequeueDeadDomainEventResult {
  readonly item: DomainEventOperationItem;
  readonly requeueEventId: string;
  readonly previousAttempts: number;
}

export async function requeueDeadDomainEvent(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly outboxId: string;
    readonly actorSubjectId: string;
    readonly actorRoleKey: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now?: Date;
  },
): Promise<RequeueDeadDomainEventResult> {
  const reason = input.reason.trim();
  if (reason === '') throw new Error('DOMAIN_EVENT_REQUEUE_REASON_REQUIRED');
  const now = input.now ?? new Date();

  const locked = await client.query<{
    readonly event_id: string;
    readonly status: DomainEventOperationStatus;
    readonly attempts: number;
  }>(
    `SELECT event_id, status, attempts
       FROM platform.domain_event_outbox
      WHERE tenant_id = $1::uuid
        AND outbox_id = $2::uuid
      FOR UPDATE`,
    [input.tenantId, input.outboxId],
  );
  const row = locked.rows[0];
  if (row === undefined) throw new Error('DOMAIN_EVENT_OUTBOX_NOT_FOUND');
  if (row.status !== 'DEAD') throw new Error('DOMAIN_EVENT_OUTBOX_NOT_DEAD');

  const audit = await client.query<{ readonly requeue_event_id: string }>(
    `INSERT INTO platform.domain_event_outbox_requeue_events (
       tenant_id, outbox_id, event_id, previous_status, previous_attempts,
       reason, authorized_by_subject_id, authorized_by_role_key,
       correlation_id, requeued_at
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, 'DEAD', $4,
       $5, $6, $7, $8::uuid, $9
     )
     RETURNING requeue_event_id`,
    [
      input.tenantId,
      input.outboxId,
      row.event_id,
      row.attempts,
      reason,
      input.actorSubjectId,
      input.actorRoleKey,
      input.correlationId,
      now,
    ],
  );
  const requeueEventId = audit.rows[0]?.requeue_event_id;
  if (requeueEventId === undefined) {
    throw new Error('DOMAIN_EVENT_REQUEUE_AUDIT_FAILED');
  }

  await client.query(
    `UPDATE platform.domain_event_outbox
        SET status = 'PENDING',
            attempts = 0,
            available_at = $3,
            claimed_at = NULL,
            published_at = NULL,
            last_error = NULL,
            updated_at = $3
      WHERE tenant_id = $1::uuid
        AND outbox_id = $2::uuid`,
    [input.tenantId, input.outboxId, now],
  );

  const item = await loadDomainEventOperationById(client, {
    tenantId: input.tenantId,
    outboxId: input.outboxId,
  });
  if (item === null) throw new Error('DOMAIN_EVENT_REQUEUE_READBACK_FAILED');

  return {
    item,
    requeueEventId,
    previousAttempts: row.attempts,
  };
}
