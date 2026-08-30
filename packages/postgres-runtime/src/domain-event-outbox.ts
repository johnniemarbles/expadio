import type { DomainEventEnvelope } from '@expadio/domain-events';

export type DomainEventOutboxStatus =
  | 'PENDING'
  | 'CLAIMED'
  | 'PUBLISHED'
  | 'FAILED'
  | 'DEAD';

export interface DomainEventOutboxSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface DomainEventOutboxSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<DomainEventOutboxSqlResult<Row>>;
}

export interface ClaimedDomainEventOutboxItem {
  readonly outboxId: string;
  readonly tenantId: string;
  readonly eventId: string;
  readonly topic: string;
  readonly partitionKey: string;
  readonly attempts: number;
  readonly claimedAt: Date;
  readonly claimToken: string;
  readonly claimExpiresAt: Date;
  readonly event: DomainEventEnvelope;
}

interface ClaimRow {
  readonly outbox_id: string;
  readonly tenant_id: string;
  readonly event_id: string;
  readonly topic: string;
  readonly partition_key: string;
  readonly attempts: number;
  readonly claimed_at: Date | string;
  readonly claim_token: string;
  readonly claim_expires_at: Date | string;
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

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function requireDate(value: Date | undefined, field: string): Date {
  const date = value ?? new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error(`DOMAIN_EVENT_OUTBOX_${field.toUpperCase()}_INVALID`);
  }
  return date;
}

function positiveInteger(
  value: number,
  field: string,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`DOMAIN_EVENT_OUTBOX_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function mapClaim(row: ClaimRow): ClaimedDomainEventOutboxItem {
  return {
    outboxId: row.outbox_id,
    tenantId: row.tenant_id,
    eventId: row.event_id,
    topic: row.topic,
    partitionKey: row.partition_key,
    attempts: row.attempts,
    claimedAt: asDate(row.claimed_at),
    claimToken: row.claim_token,
    claimExpiresAt: asDate(row.claim_expires_at),
    event: {
      eventId: row.event_id,
      tenantId: row.tenant_id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      eventVersion: row.event_version,
      occurredAt: asDate(row.occurred_at),
      recordedAt: asDate(row.recorded_at),
      actorSubjectId: row.actor_subject_id,
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      packKey: row.pack_key,
      packVersion: row.pack_version,
      payload: row.payload,
      metadata: row.metadata,
    },
  };
}

/**
 * Claim a tenant-scoped batch of outbox rows.
 *
 * - PENDING / FAILED rows become eligible at available_at.
 * - expired CLAIMED rows can be reclaimed.
 * - exhausted rows are moved to DEAD before new claims are selected.
 * - FOR UPDATE SKIP LOCKED allows concurrent workers without duplicate claims.
 */
export async function claimDomainEventOutboxBatch(
  client: DomainEventOutboxSqlClient,
  input: {
    readonly tenantId: string;
    readonly batchSize?: number;
    readonly leaseSeconds?: number;
    readonly maxAttempts?: number;
    readonly now?: Date;
  },
): Promise<readonly ClaimedDomainEventOutboxItem[]> {
  const batchSize = positiveInteger(input.batchSize ?? 20, 'batch_size', 200);
  const leaseSeconds = positiveInteger(input.leaseSeconds ?? 60, 'lease_seconds', 3600);
  const maxAttempts = positiveInteger(input.maxAttempts ?? 8, 'max_attempts', 100);
  const now = requireDate(input.now, 'now');

  // A worker may die on its final attempt. Once that lease expires, move the
  // row to DEAD instead of allowing an attempt beyond maxAttempts.
  await client.query(
    `UPDATE platform.domain_event_outbox
        SET status = 'DEAD',
            claim_token = NULL,
            claim_expires_at = NULL,
            last_error = COALESCE(last_error, 'Maximum delivery attempts exhausted.'),
            updated_at = $2
      WHERE tenant_id = $1::uuid
        AND attempts >= $3
        AND (
          status IN ('PENDING','FAILED')
          OR (status = 'CLAIMED' AND claim_expires_at <= $2)
        )`,
    [input.tenantId, now, maxAttempts],
  );

  const result = await client.query<ClaimRow>(
    `WITH candidates AS (
       SELECT outbox_id
         FROM platform.domain_event_outbox
        WHERE tenant_id = $1::uuid
          AND attempts < $4
          AND (
            (status IN ('PENDING','FAILED') AND available_at <= $5)
            OR
            (status = 'CLAIMED' AND claim_expires_at <= $5)
          )
          AND NOT EXISTS (
            SELECT 1
              FROM platform.domain_event_outbox earlier
             WHERE earlier.tenant_id = platform.domain_event_outbox.tenant_id
               AND earlier.partition_key = platform.domain_event_outbox.partition_key
               AND earlier.outbox_id <> platform.domain_event_outbox.outbox_id
               AND earlier.status <> 'PUBLISHED'
               AND (
                 earlier.created_at < platform.domain_event_outbox.created_at
                 OR (
                   earlier.created_at = platform.domain_event_outbox.created_at
                   AND earlier.outbox_id < platform.domain_event_outbox.outbox_id
                 )
               )
          )
        ORDER BY available_at, created_at, outbox_id
        FOR UPDATE SKIP LOCKED
        LIMIT $2
     ),
     claimed AS (
       UPDATE platform.domain_event_outbox outbox
          SET status = 'CLAIMED',
              attempts = outbox.attempts + 1,
              claimed_at = $5,
              claim_token = gen_random_uuid(),
              claim_expires_at = $5 + make_interval(secs => $3),
              updated_at = $5::timestamptz
         FROM candidates
        WHERE outbox.outbox_id = candidates.outbox_id
       RETURNING
         outbox.outbox_id,
         outbox.tenant_id,
         outbox.event_id,
         outbox.topic,
         outbox.partition_key,
         outbox.attempts,
         outbox.claimed_at,
         outbox.claim_token,
         outbox.claim_expires_at
     )
     SELECT
       claimed.outbox_id,
       claimed.tenant_id,
       claimed.event_id,
       claimed.topic,
       claimed.partition_key,
       claimed.attempts,
       claimed.claimed_at,
       claimed.claim_token,
       claimed.claim_expires_at,
       event.aggregate_type,
       event.aggregate_id,
       event.event_type,
       event.event_version,
       event.occurred_at,
       event.recorded_at,
       event.actor_subject_id,
       event.correlation_id,
       event.causation_id,
       event.pack_key,
       event.pack_version,
       event.payload,
       event.metadata
       FROM claimed
       JOIN platform.domain_events event
         ON event.tenant_id = claimed.tenant_id
        AND event.event_id = claimed.event_id
      ORDER BY claimed.claimed_at, claimed.outbox_id`,
    [input.tenantId, batchSize, leaseSeconds, maxAttempts, now],
  );

  return result.rows.map(mapClaim);
}

async function updateClaimedRow(
  client: DomainEventOutboxSqlClient,
  input: {
    readonly tenantId: string;
    readonly outboxId: string;
    readonly claimToken: string;
    readonly now: Date;
    readonly sqlSet: string;
    readonly values: readonly unknown[];
  },
): Promise<void> {
  const result = await client.query(
    `UPDATE platform.domain_event_outbox
        SET ${input.sqlSet}
      WHERE tenant_id = $1::uuid
        AND outbox_id = $2::uuid
        AND status = 'CLAIMED'
        AND claim_token = $3::uuid
        AND claim_expires_at > $4`,
    [
      input.tenantId,
      input.outboxId,
      input.claimToken,
      input.now,
      ...input.values,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error('DOMAIN_EVENT_OUTBOX_CLAIM_LOST');
  }
}

export async function extendDomainEventOutboxClaim(
  client: DomainEventOutboxSqlClient,
  input: {
    readonly tenantId: string;
    readonly outboxId: string;
    readonly claimToken: string;
    readonly leaseSeconds?: number;
    readonly now?: Date;
  },
): Promise<void> {
  const leaseSeconds = positiveInteger(input.leaseSeconds ?? 60, 'lease_seconds', 3600);
  const now = requireDate(input.now, 'now');
  await updateClaimedRow(client, {
    tenantId: input.tenantId,
    outboxId: input.outboxId,
    claimToken: input.claimToken,
    now,
    sqlSet: `claim_expires_at = $5::timestamptz + make_interval(secs => $6::double precision), updated_at = $5::timestamptz::timestamptz`,
    values: [now, leaseSeconds],
  });
}

export async function publishDomainEventOutboxClaim(
  client: DomainEventOutboxSqlClient,
  input: {
    readonly tenantId: string;
    readonly outboxId: string;
    readonly claimToken: string;
    readonly publishedAt?: Date;
  },
): Promise<void> {
  const publishedAt = requireDate(input.publishedAt, 'published_at');
  await updateClaimedRow(client, {
    tenantId: input.tenantId,
    outboxId: input.outboxId,
    claimToken: input.claimToken,
    now: publishedAt,
    sqlSet: `status = 'PUBLISHED',
             published_at = $5,
             claim_token = NULL,
             claim_expires_at = NULL,
             last_error = NULL,
             updated_at = $5::timestamptz`,
    values: [publishedAt],
  });
}

export async function failDomainEventOutboxClaim(
  client: DomainEventOutboxSqlClient,
  input: {
    readonly tenantId: string;
    readonly outboxId: string;
    readonly claimToken: string;
    readonly error: string;
    readonly maxAttempts?: number;
    readonly retryDelaySeconds?: number;
    readonly failedAt?: Date;
  },
): Promise<'FAILED' | 'DEAD'> {
  const maxAttempts = positiveInteger(input.maxAttempts ?? 8, 'max_attempts', 100);
  const retryDelaySeconds = positiveInteger(
    input.retryDelaySeconds ?? 30,
    'retry_delay_seconds',
    86400,
  );
  const failedAt = requireDate(input.failedAt, 'failed_at');
  const error = input.error.trim();
  if (error === '') throw new Error('DOMAIN_EVENT_OUTBOX_ERROR_REQUIRED');

  const result = await client.query<{ readonly status: 'FAILED' | 'DEAD' }>(
    `UPDATE platform.domain_event_outbox
        SET status = CASE WHEN attempts >= $5 THEN 'DEAD' ELSE 'FAILED' END,
            available_at = CASE
              WHEN attempts < $5
              THEN $6::timestamptz + make_interval(secs => $7::double precision)
              ELSE available_at
            END,
            claim_token = NULL,
            claim_expires_at = NULL,
            last_error = $8,
            updated_at = $6::timestamptz
      WHERE tenant_id = $1::uuid
        AND outbox_id = $2::uuid
        AND status = 'CLAIMED'
        AND claim_token = $3::uuid
        AND claim_expires_at > $4
      RETURNING status`,
    [
      input.tenantId,
      input.outboxId,
      input.claimToken,
      failedAt,
      maxAttempts,
      failedAt,
      retryDelaySeconds,
      error,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('DOMAIN_EVENT_OUTBOX_CLAIM_LOST');
  }
  return row.status;
}
