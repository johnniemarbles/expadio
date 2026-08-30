import type { DomainEventEnvelope } from '@expadio/domain-events';
import { loadDomainEvent, type DomainEventSqlClient } from './domain-events.ts';

export interface DomainEventOutboxClaim {
  readonly outboxId: string;
  readonly tenantId: string;
  readonly eventId: string;
  readonly topic: string;
  readonly partitionKey: string;
  readonly attempts: number;
  readonly claimedAt: Date;
  readonly event: DomainEventEnvelope;
}

interface OutboxClaimRow {
  readonly outbox_id: string;
  readonly tenant_id: string;
  readonly event_id: string;
  readonly topic: string;
  readonly partition_key: string;
  readonly attempts: number;
  readonly claimed_at: Date | string;
}

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function positiveLeaseMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('DOMAIN_EVENT_OUTBOX_LEASE_INVALID');
  }
  return value;
}

function positiveMaxAttempts(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('DOMAIN_EVENT_OUTBOX_MAX_ATTEMPTS_INVALID');
  }
  return value;
}

/**
 * Claim one available Domain Event outbox row without blocking another worker.
 *
 * CLAIMED rows whose lease expired are eligible for recovery. The claim update
 * increments attempts before business processing starts so crash loops remain
 * observable and bounded by maxAttempts.
 *
 * Partition ordering is strict: a later event for the same partition cannot be
 * claimed until every earlier event in that partition is PUBLISHED.
 */
export async function claimDomainEventOutbox(
  client: DomainEventSqlClient,
  input: {
    readonly tenantId: string;
    readonly now?: Date;
    readonly leaseMs?: number;
    readonly maxAttempts?: number;
  },
): Promise<DomainEventOutboxClaim | null> {
  const now = input.now ?? new Date();
  const leaseMs = positiveLeaseMs(input.leaseMs ?? 60_000);
  const maxAttempts = positiveMaxAttempts(input.maxAttempts ?? 8);
  const staleBefore = new Date(now.getTime() - leaseMs);

  // If a worker died on its final allowed attempt, the row must not remain
  // CLAIMED forever merely because attempts is no longer below maxAttempts.
  await client.query(
    `UPDATE platform.domain_event_outbox
        SET status = 'DEAD',
            claimed_at = NULL,
            last_error = COALESCE(last_error, 'Maximum delivery attempts exhausted after lease expiry.'),
            updated_at = $2
      WHERE tenant_id = $1::uuid
        AND status = 'CLAIMED'
        AND attempts >= $4
        AND claimed_at <= $3`,
    [input.tenantId, now, staleBefore, maxAttempts],
  );

  const claimed = await client.query<OutboxClaimRow>(
    `WITH candidate AS (
       SELECT outbox_id
         FROM platform.domain_event_outbox current_row
        WHERE tenant_id = $1::uuid
          AND attempts < $4
          AND available_at <= $2
          AND (
            status IN ('PENDING','FAILED')
            OR (status = 'CLAIMED' AND claimed_at <= $3)
          )
          AND NOT EXISTS (
            SELECT 1
              FROM platform.domain_event_outbox earlier
             WHERE earlier.tenant_id = current_row.tenant_id
               AND earlier.partition_key = current_row.partition_key
               AND earlier.outbox_id <> current_row.outbox_id
               AND earlier.status <> 'PUBLISHED'
               AND (
                 earlier.created_at < current_row.created_at
                 OR (
                   earlier.created_at = current_row.created_at
                   AND earlier.outbox_id < current_row.outbox_id
                 )
               )
          )
        ORDER BY available_at, created_at, outbox_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     UPDATE platform.domain_event_outbox outbox
        SET status = 'CLAIMED',
            attempts = outbox.attempts + 1,
            claimed_at = $2,
            last_error = NULL,
            updated_at = $2
       FROM candidate
      WHERE outbox.outbox_id = candidate.outbox_id
      RETURNING outbox.outbox_id, outbox.tenant_id, outbox.event_id,
                outbox.topic, outbox.partition_key, outbox.attempts,
                outbox.claimed_at`,
    [input.tenantId, now, staleBefore, maxAttempts],
  );
  const row = claimed.rows[0];
  if (row === undefined) return null;

  const event = await loadDomainEvent(client, {
    tenantId: row.tenant_id,
    eventId: row.event_id,
  });
  if (event === null) throw new Error('DOMAIN_EVENT_OUTBOX_EVENT_NOT_FOUND');

  return {
    outboxId: row.outbox_id,
    tenantId: row.tenant_id,
    eventId: row.event_id,
    topic: row.topic,
    partitionKey: row.partition_key,
    attempts: row.attempts,
    claimedAt: date(row.claimed_at),
    event,
  };
}

export async function completeDomainEventOutbox(
  client: DomainEventSqlClient,
  input: {
    readonly tenantId: string;
    readonly outboxId: string;
    readonly claimedAt: Date;
    readonly completedAt?: Date;
    readonly leaseMs?: number;
  },
): Promise<boolean> {
  const completedAt = input.completedAt ?? new Date();
  const leaseMs = positiveLeaseMs(input.leaseMs ?? 60_000);
  const staleBefore = new Date(completedAt.getTime() - leaseMs);
  const result = await client.query(
    `UPDATE platform.domain_event_outbox
        SET status = 'PUBLISHED',
            published_at = $4,
            claimed_at = NULL,
            last_error = NULL,
            updated_at = $4
      WHERE tenant_id = $1::uuid
        AND outbox_id = $2::uuid
        AND status = 'CLAIMED'
        AND claimed_at = $3
        AND claimed_at > $5`,
    [input.tenantId, input.outboxId, input.claimedAt, completedAt, staleBefore],
  );
  return result.rowCount === 1;
}

export async function failDomainEventOutbox(
  client: DomainEventSqlClient,
  input: {
    readonly tenantId: string;
    readonly outboxId: string;
    readonly claimedAt: Date;
    readonly error: string;
    readonly retryAt?: Date;
    readonly failedAt?: Date;
    readonly maxAttempts?: number;
    readonly leaseMs?: number;
  },
): Promise<'FAILED' | 'DEAD' | 'STALE_CLAIM'> {
  const failedAt = input.failedAt ?? new Date();
  const leaseMs = positiveLeaseMs(input.leaseMs ?? 60_000);
  const maxAttempts = positiveMaxAttempts(input.maxAttempts ?? 8);
  const retryAt = input.retryAt ?? new Date(failedAt.getTime() + 60_000);
  const staleBefore = new Date(failedAt.getTime() - leaseMs);
  const result = await client.query<{ readonly status: 'FAILED' | 'DEAD' }>(
    `UPDATE platform.domain_event_outbox
        SET status = CASE WHEN attempts >= $6 THEN 'DEAD' ELSE 'FAILED' END,
            available_at = CASE WHEN attempts >= $6 THEN available_at ELSE $5 END,
            claimed_at = NULL,
            last_error = left($4, 4000),
            updated_at = $7
      WHERE tenant_id = $1::uuid
        AND outbox_id = $2::uuid
        AND status = 'CLAIMED'
        AND claimed_at = $3
        AND claimed_at > $8
      RETURNING status`,
    [
      input.tenantId,
      input.outboxId,
      input.claimedAt,
      input.error || 'Unknown domain event worker failure',
      retryAt,
      maxAttempts,
      failedAt,
      staleBefore,
    ],
  );
  return result.rows[0]?.status ?? 'STALE_CLAIM';
}
