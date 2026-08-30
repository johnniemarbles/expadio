import type { PoolClient } from 'pg';
import type { CommunicationDeliveryClaim } from './communication-delivery-worker';

export type CommunicationProviderAttemptOutcome =
  | 'ACCEPTED'
  | 'RETRYABLE_FAILURE'
  | 'REJECTED'
  | 'ERROR';

export interface PersistedCommunicationProviderAttempt {
  readonly providerAttemptId: string;
  readonly tenantId: string;
  readonly deliveryId: string;
  readonly attemptToken: string;
  readonly connectorKey: string;
  readonly providerKey: string;
  readonly adapterKey: string;
  readonly idempotencyKey: string;
  readonly outcome: CommunicationProviderAttemptOutcome;
  readonly providerMessageId: string | null;
  readonly reasonCode: string;
  readonly reason: string | null;
  readonly startedAt: Date;
  readonly completedAt: Date;
}

interface ProviderAttemptRow {
  readonly provider_attempt_id: string;
  readonly tenant_id: string;
  readonly delivery_id: string;
  readonly attempt_token: string;
  readonly connector_key: string;
  readonly provider_key: string;
  readonly adapter_key: string;
  readonly idempotency_key: string;
  readonly outcome: CommunicationProviderAttemptOutcome;
  readonly provider_message_id: string | null;
  readonly reason_code: string;
  readonly reason: string | null;
  readonly started_at: Date | string;
  readonly completed_at: Date | string;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapAttempt(row: ProviderAttemptRow): PersistedCommunicationProviderAttempt {
  return {
    providerAttemptId: row.provider_attempt_id,
    tenantId: row.tenant_id,
    deliveryId: row.delivery_id,
    attemptToken: row.attempt_token,
    connectorKey: row.connector_key,
    providerKey: row.provider_key,
    adapterKey: row.adapter_key,
    idempotencyKey: row.idempotency_key,
    outcome: row.outcome,
    providerMessageId: row.provider_message_id,
    reasonCode: row.reason_code,
    reason: row.reason,
    startedAt: asDate(row.started_at),
    completedAt: asDate(row.completed_at),
  };
}

const COLUMNS = `
  provider_attempt_id, tenant_id, delivery_id, attempt_token,
  connector_key, provider_key, adapter_key, idempotency_key,
  outcome, provider_message_id, reason_code, reason, started_at, completed_at
`;

export async function renewCommunicationDeliveryClaim(
  client: PoolClient,
  input: {
    readonly claim: CommunicationDeliveryClaim;
    readonly now: Date;
    readonly leaseMs: number;
  },
): Promise<Date | null> {
  if (!Number.isFinite(input.leaseMs) || input.leaseMs <= 0) {
    throw new Error('COMMUNICATION_DELIVERY_LEASE_INVALID');
  }
  const expiresAt = new Date(input.now.getTime() + input.leaseMs);

  await client.query('BEGIN');
  try {
    const renewed = await client.query(
      `UPDATE platform.communication_deliveries
          SET claim_expires_at = $4::timestamptz,
              updated_at = $3::timestamptz
        WHERE tenant_id = $1::uuid
          AND delivery_id = $2::uuid
          AND state = 'PENDING'
          AND claim_token = $5::uuid
          AND claim_expires_at > $3::timestamptz`,
      [
        input.claim.tenantId,
        input.claim.deliveryId,
        input.now,
        expiresAt,
        input.claim.claimToken,
      ],
    );
    if (renewed.rowCount !== 1) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(
      `INSERT INTO platform.communication_delivery_events (
         delivery_id, tenant_id, from_state, to_state, reason_code, reason,
         occurred_at, attempt_token
       ) VALUES (
         $1::uuid, $2::uuid, 'PENDING', 'PENDING',
         'DELIVERY_CLAIM_RENEWED', 'Provider-call lease renewed.',
         $3::timestamptz, $4::uuid
       )`,
      [
        input.claim.deliveryId,
        input.claim.tenantId,
        input.now,
        input.claim.claimToken,
      ],
    );

    await client.query('COMMIT');
    return expiresAt;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function recordCommunicationProviderAttempt(
  client: PoolClient,
  input: {
    readonly claim: CommunicationDeliveryClaim;
    readonly providerKey: string;
    readonly outcome: CommunicationProviderAttemptOutcome;
    readonly providerMessageId?: string;
    readonly reasonCode: string;
    readonly reason?: string | null;
    readonly startedAt: Date;
    readonly completedAt: Date;
  },
): Promise<PersistedCommunicationProviderAttempt> {
  const inserted = await client.query<ProviderAttemptRow>(
    `INSERT INTO platform.communication_provider_attempts (
       tenant_id, delivery_id, attempt_token, connector_key, provider_key,
       adapter_key, idempotency_key, outcome, provider_message_id,
       reason_code, reason, started_at, completed_at
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11,
       $12::timestamptz, $13::timestamptz
     )
     ON CONFLICT (tenant_id, delivery_id, attempt_token) DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      input.claim.tenantId,
      input.claim.deliveryId,
      input.claim.claimToken,
      input.claim.connectorKey,
      input.providerKey,
      input.claim.adapterKey,
      input.claim.idempotencyKey,
      input.outcome,
      input.providerMessageId ?? null,
      input.reasonCode,
      input.reason ?? null,
      input.startedAt,
      input.completedAt,
    ],
  );
  const created = inserted.rows[0];
  if (created !== undefined) return mapAttempt(created);

  const existing = await client.query<ProviderAttemptRow>(
    `SELECT ${COLUMNS}
       FROM platform.communication_provider_attempts
      WHERE tenant_id = $1::uuid
        AND delivery_id = $2::uuid
        AND attempt_token = $3::uuid
      LIMIT 1`,
    [input.claim.tenantId, input.claim.deliveryId, input.claim.claimToken],
  );
  const row = existing.rows[0];
  if (row === undefined) throw new Error('COMMUNICATION_PROVIDER_ATTEMPT_WRITE_FAILED');

  if (
    row.provider_key !== input.providerKey
    || row.idempotency_key !== input.claim.idempotencyKey
    || row.outcome !== input.outcome
    || row.provider_message_id !== (input.providerMessageId ?? null)
  ) {
    throw new Error('COMMUNICATION_PROVIDER_ATTEMPT_REPLAY_CONFLICT');
  }
  return mapAttempt(row);
}

export async function reconcileAcceptedCommunicationProviderAttempt(
  client: PoolClient,
  input: {
    readonly attempt: PersistedCommunicationProviderAttempt;
    readonly reconciledAt: Date;
  },
): Promise<'RECONCILED' | 'ALREADY_ACCEPTED' | 'NOT_RECONCILABLE'> {
  if (input.attempt.outcome !== 'ACCEPTED' || input.attempt.providerMessageId === null) {
    return 'NOT_RECONCILABLE';
  }

  await client.query('BEGIN');
  try {
    const current = await client.query<{
      readonly state: string;
      readonly idempotency_key: string;
      readonly connector_key: string;
      readonly adapter_key: string;
      readonly provider_message_id: string | null;
    }>(
      `SELECT state, idempotency_key, connector_key, adapter_key, provider_message_id
         FROM platform.communication_deliveries
        WHERE tenant_id = $1::uuid
          AND delivery_id = $2::uuid
        FOR UPDATE`,
      [input.attempt.tenantId, input.attempt.deliveryId],
    );
    const row = current.rows[0];
    if (row === undefined) {
      await client.query('ROLLBACK');
      return 'NOT_RECONCILABLE';
    }
    if (
      row.idempotency_key !== input.attempt.idempotencyKey
      || row.connector_key !== input.attempt.connectorKey
      || row.adapter_key !== input.attempt.adapterKey
    ) {
      await client.query('ROLLBACK');
      return 'NOT_RECONCILABLE';
    }
    if (row.state === 'ACCEPTED') {
      const sameProviderMessage = row.provider_message_id === input.attempt.providerMessageId;
      await client.query('ROLLBACK');
      return sameProviderMessage ? 'ALREADY_ACCEPTED' : 'NOT_RECONCILABLE';
    }
    if (row.state !== 'PENDING') {
      await client.query('ROLLBACK');
      return 'NOT_RECONCILABLE';
    }

    const updated = await client.query(
      `UPDATE platform.communication_deliveries
          SET state = 'ACCEPTED',
              provider_message_id = $3,
              attempt_count = attempt_count + 1,
              last_attempt_at = $4::timestamptz,
              last_reason_code = 'PROVIDER_ACCEPTED_RECONCILED',
              last_reason = 'Provider acceptance reconciled from immutable attempt evidence.',
              accepted_at = COALESCE(accepted_at, $5::timestamptz),
              claim_token = NULL,
              claim_expires_at = NULL,
              updated_at = $4::timestamptz
        WHERE tenant_id = $1::uuid
          AND delivery_id = $2::uuid
          AND state = 'PENDING'`,
      [
        input.attempt.tenantId,
        input.attempt.deliveryId,
        input.attempt.providerMessageId,
        input.reconciledAt,
        input.attempt.completedAt,
      ],
    );
    if (updated.rowCount !== 1) {
      await client.query('ROLLBACK');
      return 'NOT_RECONCILABLE';
    }

    await client.query(
      `INSERT INTO platform.communication_delivery_events (
         delivery_id, tenant_id, from_state, to_state, reason_code, reason,
         occurred_at, attempt_token
       ) VALUES (
         $1::uuid, $2::uuid, 'PENDING', 'ACCEPTED',
         'PROVIDER_ACCEPTED_RECONCILED',
         'Provider acceptance reconciled after claim-bound finalization could not complete.',
         $3::timestamptz, $4::uuid
       )`,
      [
        input.attempt.deliveryId,
        input.attempt.tenantId,
        input.reconciledAt,
        input.attempt.attemptToken,
      ],
    );

    await client.query('COMMIT');
    return 'RECONCILED';
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
