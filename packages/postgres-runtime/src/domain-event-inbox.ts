import type { DomainEventEnvelope } from '@expadio/domain-events';

export type DomainEventInboxStatus =
  | 'PENDING'
  | 'CLAIMED'
  | 'PROCESSED'
  | 'FAILED'
  | 'DEAD';

export interface DomainEventInboxSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface DomainEventInboxSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<DomainEventInboxSqlResult<Row>>;
}

export interface DomainEventInboxDelivery {
  readonly inboxId: string;
  readonly tenantId: string;
  readonly consumerKey: string;
  readonly eventId: string;
  readonly topic: string;
  readonly partitionKey: string;
  readonly status: DomainEventInboxStatus;
  readonly attempts: number;
  readonly availableAt: Date;
  readonly receivedAt: Date;
  readonly claimedAt: Date | null;
  readonly claimToken: string | null;
  readonly claimExpiresAt: Date | null;
  readonly processedAt: Date | null;
  readonly lastError: string | null;
}

export interface ClaimedDomainEventInboxItem extends DomainEventInboxDelivery {
  readonly status: 'CLAIMED';
  readonly claimedAt: Date;
  readonly claimToken: string;
  readonly claimExpiresAt: Date;
  readonly event: DomainEventEnvelope;
}

interface InboxRow {
  readonly inbox_id: string;
  readonly tenant_id: string;
  readonly consumer_key: string;
  readonly event_id: string;
  readonly topic: string;
  readonly partition_key: string;
  readonly status: DomainEventInboxStatus;
  readonly attempts: number;
  readonly available_at: Date | string;
  readonly received_at: Date | string;
  readonly claimed_at: Date | string | null;
  readonly claim_token: string | null;
  readonly claim_expires_at: Date | string | null;
  readonly processed_at: Date | string | null;
  readonly last_error: string | null;
}

interface ClaimRow extends InboxRow {
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

function optionalDate(value: Date | string | null): Date | null {
  return value === null ? null : asDate(value);
}

function requireDate(value: Date | undefined, field: string): Date {
  const date = value ?? new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error(`DOMAIN_EVENT_INBOX_${field.toUpperCase()}_INVALID`);
  }
  return date;
}

function positiveInteger(value: number, field: string, maximum: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`DOMAIN_EVENT_INBOX_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function nonBlank(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '') throw new Error(`DOMAIN_EVENT_INBOX_${field.toUpperCase()}_REQUIRED`);
  return normalized;
}

function mapDelivery(row: InboxRow): DomainEventInboxDelivery {
  return {
    inboxId: row.inbox_id,
    tenantId: row.tenant_id,
    consumerKey: row.consumer_key,
    eventId: row.event_id,
    topic: row.topic,
    partitionKey: row.partition_key,
    status: row.status,
    attempts: row.attempts,
    availableAt: asDate(row.available_at),
    receivedAt: asDate(row.received_at),
    claimedAt: optionalDate(row.claimed_at),
    claimToken: row.claim_token,
    claimExpiresAt: optionalDate(row.claim_expires_at),
    processedAt: optionalDate(row.processed_at),
    lastError: row.last_error,
  };
}

function mapClaim(row: ClaimRow): ClaimedDomainEventInboxItem {
  const delivery = mapDelivery(row);
  if (
    delivery.status !== 'CLAIMED'
    || delivery.claimedAt === null
    || delivery.claimToken === null
    || delivery.claimExpiresAt === null
  ) {
    throw new Error('DOMAIN_EVENT_INBOX_CLAIM_ROW_INVALID');
  }
  return {
    ...delivery,
    status: 'CLAIMED',
    claimedAt: delivery.claimedAt,
    claimToken: delivery.claimToken,
    claimExpiresAt: delivery.claimExpiresAt,
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

const INBOX_COLUMNS = `
  inbox_id, tenant_id, consumer_key, event_id, topic, partition_key,
  status, attempts, available_at, received_at, claimed_at, claim_token,
  claim_expires_at, processed_at, last_error
`;

export async function receiveDomainEventInboxDelivery(
  client: DomainEventInboxSqlClient,
  input: {
    readonly tenantId: string;
    readonly consumerKey: string;
    readonly eventId: string;
    readonly topic: string;
    readonly partitionKey: string;
    readonly receivedAt?: Date;
  },
): Promise<DomainEventInboxDelivery> {
  const consumerKey = nonBlank(input.consumerKey, 'consumer_key');
  const topic = nonBlank(input.topic, 'topic');
  const partitionKey = nonBlank(input.partitionKey, 'partition_key');
  const receivedAt = requireDate(input.receivedAt, 'received_at');

  const inserted = await client.query<InboxRow>(
    `INSERT INTO platform.domain_event_inbox (
       tenant_id, consumer_key, event_id, topic, partition_key,
       available_at, received_at, created_at, updated_at
     ) VALUES (
       $1::uuid, $2, $3::uuid, $4, $5,
       $6, $6, $6, $6
     )
     ON CONFLICT (tenant_id, consumer_key, event_id) DO NOTHING
     RETURNING ${INBOX_COLUMNS}`,
    [input.tenantId, consumerKey, input.eventId, topic, partitionKey, receivedAt],
  );

  const created = inserted.rows[0];
  if (created !== undefined) return mapDelivery(created);

  const existing = await client.query<InboxRow>(
    `SELECT ${INBOX_COLUMNS}
       FROM platform.domain_event_inbox
      WHERE tenant_id = $1::uuid
        AND consumer_key = $2
        AND event_id = $3::uuid
      LIMIT 1`,
    [input.tenantId, consumerKey, input.eventId],
  );
  const row = existing.rows[0];
  if (row === undefined) {
    throw new Error('DOMAIN_EVENT_INBOX_IDEMPOTENCY_CONFLICT');
  }
  if (row.topic !== topic || row.partition_key !== partitionKey) {
    throw new Error('DOMAIN_EVENT_INBOX_IDEMPOTENCY_COLLISION');
  }
  return mapDelivery(row);
}

export async function claimDomainEventInboxBatch(
  client: DomainEventInboxSqlClient,
  input: {
    readonly tenantId: string;
    readonly consumerKey: string;
    readonly batchSize?: number;
    readonly leaseSeconds?: number;
    readonly maxAttempts?: number;
    readonly now?: Date;
  },
): Promise<readonly ClaimedDomainEventInboxItem[]> {
  const consumerKey = nonBlank(input.consumerKey, 'consumer_key');
  const batchSize = positiveInteger(input.batchSize ?? 20, 'batch_size', 200);
  const leaseSeconds = positiveInteger(input.leaseSeconds ?? 60, 'lease_seconds', 3600);
  const maxAttempts = positiveInteger(input.maxAttempts ?? 8, 'max_attempts', 100);
  const now = requireDate(input.now, 'now');

  await client.query(
    `UPDATE platform.domain_event_inbox
        SET status = 'DEAD',
            claim_token = NULL,
            claim_expires_at = NULL,
            last_error = COALESCE(last_error, 'Maximum consumer attempts exhausted.'),
            updated_at = $3
      WHERE tenant_id = $1::uuid
        AND consumer_key = $2
        AND attempts >= $4
        AND (
          status IN ('PENDING','FAILED')
          OR (status = 'CLAIMED' AND claim_expires_at <= $3)
        )`,
    [input.tenantId, consumerKey, now, maxAttempts],
  );

  const result = await client.query<ClaimRow>(
    `WITH candidates AS (
       SELECT inbox_id
         FROM platform.domain_event_inbox inbox
        WHERE inbox.tenant_id = $1::uuid
          AND inbox.consumer_key = $2
          AND inbox.attempts < $5
          AND (
            (inbox.status IN ('PENDING','FAILED') AND inbox.available_at <= $6)
            OR
            (inbox.status = 'CLAIMED' AND inbox.claim_expires_at <= $6)
          )
          AND NOT EXISTS (
            SELECT 1
              FROM platform.domain_event_inbox earlier
             WHERE earlier.tenant_id = inbox.tenant_id
               AND earlier.consumer_key = inbox.consumer_key
               AND earlier.partition_key = inbox.partition_key
               AND earlier.inbox_id <> inbox.inbox_id
               AND earlier.status <> 'PROCESSED'
               AND (
                 earlier.received_at < inbox.received_at
                 OR (
                   earlier.received_at = inbox.received_at
                   AND earlier.inbox_id < inbox.inbox_id
                 )
               )
          )
        ORDER BY inbox.available_at, inbox.received_at, inbox.inbox_id
        FOR UPDATE SKIP LOCKED
        LIMIT $3
     ),
     claimed AS (
       UPDATE platform.domain_event_inbox inbox
          SET status = 'CLAIMED',
              attempts = inbox.attempts + 1,
              claimed_at = $6,
              claim_token = gen_random_uuid(),
              claim_expires_at = $6 + make_interval(secs => $4),
              updated_at = $6
         FROM candidates
        WHERE inbox.inbox_id = candidates.inbox_id
       RETURNING ${INBOX_COLUMNS}
     )
     SELECT
       claimed.*,
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
      ORDER BY claimed.claimed_at, claimed.inbox_id`,
    [input.tenantId, consumerKey, batchSize, leaseSeconds, maxAttempts, now],
  );

  return result.rows.map(mapClaim);
}

async function updateClaimed(
  client: DomainEventInboxSqlClient,
  input: {
    readonly tenantId: string;
    readonly inboxId: string;
    readonly claimToken: string;
    readonly now: Date;
    readonly sqlSet: string;
    readonly values: readonly unknown[];
  },
): Promise<void> {
  const result = await client.query(
    `UPDATE platform.domain_event_inbox
        SET ${input.sqlSet}
      WHERE tenant_id = $1::uuid
        AND inbox_id = $2::uuid
        AND status = 'CLAIMED'
        AND claim_token = $3::uuid
        AND claim_expires_at > $4`,
    [input.tenantId, input.inboxId, input.claimToken, input.now, ...input.values],
  );
  if (result.rowCount !== 1) throw new Error('DOMAIN_EVENT_INBOX_CLAIM_LOST');
}

export async function extendDomainEventInboxClaim(
  client: DomainEventInboxSqlClient,
  input: {
    readonly tenantId: string;
    readonly inboxId: string;
    readonly claimToken: string;
    readonly leaseSeconds?: number;
    readonly now?: Date;
  },
): Promise<void> {
  const leaseSeconds = positiveInteger(input.leaseSeconds ?? 60, 'lease_seconds', 3600);
  const now = requireDate(input.now, 'now');
  await updateClaimed(client, {
    tenantId: input.tenantId,
    inboxId: input.inboxId,
    claimToken: input.claimToken,
    now,
    sqlSet: `claim_expires_at = $5 + make_interval(secs => $6), updated_at = $5`,
    values: [now, leaseSeconds],
  });
}

export async function processDomainEventInboxClaim(
  client: DomainEventInboxSqlClient,
  input: {
    readonly tenantId: string;
    readonly inboxId: string;
    readonly claimToken: string;
    readonly processedAt?: Date;
  },
): Promise<void> {
  const processedAt = requireDate(input.processedAt, 'processed_at');
  await updateClaimed(client, {
    tenantId: input.tenantId,
    inboxId: input.inboxId,
    claimToken: input.claimToken,
    now: processedAt,
    sqlSet: `status = 'PROCESSED',
             processed_at = $5,
             claim_token = NULL,
             claim_expires_at = NULL,
             last_error = NULL,
             updated_at = $5`,
    values: [processedAt],
  });
}

export async function failDomainEventInboxClaim(
  client: DomainEventInboxSqlClient,
  input: {
    readonly tenantId: string;
    readonly inboxId: string;
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
  if (error === '') throw new Error('DOMAIN_EVENT_INBOX_ERROR_REQUIRED');

  const result = await client.query<{ readonly status: 'FAILED' | 'DEAD' }>(
    `UPDATE platform.domain_event_inbox
        SET status = CASE WHEN attempts >= $5 THEN 'DEAD' ELSE 'FAILED' END,
            available_at = CASE
              WHEN attempts < $5
              THEN $6 + make_interval(secs => $7)
              ELSE available_at
            END,
            claim_token = NULL,
            claim_expires_at = NULL,
            last_error = $8,
            updated_at = $6
      WHERE tenant_id = $1::uuid
        AND inbox_id = $2::uuid
        AND status = 'CLAIMED'
        AND claim_token = $3::uuid
        AND claim_expires_at > $4
      RETURNING status`,
    [
      input.tenantId,
      input.inboxId,
      input.claimToken,
      failedAt,
      maxAttempts,
      failedAt,
      retryDelaySeconds,
      error,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('DOMAIN_EVENT_INBOX_CLAIM_LOST');
  return row.status;
}
