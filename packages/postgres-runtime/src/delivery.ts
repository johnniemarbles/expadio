import {
  assertDeliveryTransition,
  type CommunicationDeliveryState,
} from '@expadio/communication/delivery-state';
import type {
  ApplyCommunicationDeliveryTransitionInput,
  ApplyCommunicationDeliveryTransitionResult,
  CommunicationDeliveryDispatchSnapshot,
  CommunicationDeliveryRecord,
  CommunicationDeliveryRepository,
  CreateCommunicationDeliveryInput,
  RecordCommunicationDeliveryAttemptInput,
} from '@expadio/communication/delivery-repository';
import type { CommunicationChannel } from '@expadio/communication';
import type { PostgresClient } from './index.ts';

interface DeliveryRow {
  readonly delivery_id: string;
  readonly tenant_id: string;
  readonly organization_id: string | null;
  readonly idempotency_key: string;
  readonly channel: CommunicationChannel;
  readonly connector_key: string;
  readonly adapter_key: string;
  readonly provider_message_id: string | null;
  readonly state: CommunicationDeliveryState;
  readonly attempt_count: number;
  readonly last_reason_code: string | null;
  readonly last_reason: string | null;
  readonly requested_at: Date | string;
  readonly accepted_at: Date | string | null;
  readonly updated_at: Date | string;
  readonly dispatch_snapshot: CommunicationDeliveryDispatchSnapshot | null;
  readonly next_attempt_at: Date | string | null;
  readonly last_attempt_at: Date | string | null;
  readonly claim_token: string | null;
  readonly claim_expires_at: Date | string | null;
}

const DELIVERY_COLUMNS = `delivery_id, tenant_id, organization_id, idempotency_key,
  channel, connector_key, adapter_key, provider_message_id, state, attempt_count,
  last_reason_code, last_reason, requested_at, accepted_at, updated_at,
  dispatch_snapshot, next_attempt_at, last_attempt_at, claim_token, claim_expires_at`;

export class PostgresCommunicationDeliveryRepository
  implements CommunicationDeliveryRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async createOrGet(input: CreateCommunicationDeliveryInput): Promise<CommunicationDeliveryRecord> {
    const result = await this.#client.query<DeliveryRow>(
      `INSERT INTO platform.communication_deliveries (
         tenant_id, organization_id, idempotency_key, channel,
         connector_key, adapter_key, requested_at, dispatch_snapshot, next_attempt_at
       ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb, $7)
       ON CONFLICT (tenant_id, idempotency_key)
       DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       WHERE platform.communication_deliveries.organization_id
               IS NOT DISTINCT FROM EXCLUDED.organization_id
         AND platform.communication_deliveries.channel = EXCLUDED.channel
         AND platform.communication_deliveries.connector_key = EXCLUDED.connector_key
         AND platform.communication_deliveries.adapter_key = EXCLUDED.adapter_key
         AND platform.communication_deliveries.dispatch_snapshot
               IS NOT DISTINCT FROM EXCLUDED.dispatch_snapshot
       RETURNING ${DELIVERY_COLUMNS}`,
      [
        input.tenantId,
        input.organizationId ?? null,
        input.idempotencyKey,
        input.channel,
        input.connectorKey,
        input.adapterKey,
        input.requestedAt,
        input.dispatchSnapshot === undefined
          ? null
          : JSON.stringify(input.dispatchSnapshot),
      ],
    );
    const row = result.rows[0];
    if (row !== undefined) return mapDelivery(row);

    const existing = await this.#client.query<DeliveryRow>(
      `SELECT ${DELIVERY_COLUMNS}
         FROM platform.communication_deliveries
        WHERE tenant_id = $1::uuid AND idempotency_key = $2
        LIMIT 1`,
      [input.tenantId, input.idempotencyKey],
    );
    if (existing.rows[0] !== undefined) {
      throw new Error('COMMUNICATION_DELIVERY_IDEMPOTENCY_CONFLICT');
    }
    throw new Error('COMMUNICATION_DELIVERY_WRITE_FAILED');
  }

  async findByIdempotencyKey(input: {
    readonly tenantId: string;
    readonly idempotencyKey: string;
  }): Promise<CommunicationDeliveryRecord | null> {
    const result = await this.#client.query<DeliveryRow>(
      `SELECT ${DELIVERY_COLUMNS}
         FROM platform.communication_deliveries
        WHERE tenant_id = $1::uuid AND idempotency_key = $2`,
      [input.tenantId, input.idempotencyKey],
    );
    return result.rows[0] === undefined ? null : mapDelivery(result.rows[0]);
  }

  async findByProviderMessageId(input: {
    readonly tenantId: string;
    readonly connectorKey: string;
    readonly providerMessageId: string;
  }): Promise<CommunicationDeliveryRecord | null> {
    const result = await this.#client.query<DeliveryRow>(
      `SELECT ${DELIVERY_COLUMNS}
         FROM platform.communication_deliveries
        WHERE tenant_id = $1::uuid
          AND connector_key = $2
          AND provider_message_id = $3
        LIMIT 1`,
      [input.tenantId, input.connectorKey, input.providerMessageId],
    );
    return result.rows[0] === undefined ? null : mapDelivery(result.rows[0]);
  }

  async recordAttempt(
    input: RecordCommunicationDeliveryAttemptInput,
  ): Promise<CommunicationDeliveryRecord> {
    const currentResult = await this.#client.query<DeliveryRow>(
      `SELECT ${DELIVERY_COLUMNS}
         FROM platform.communication_deliveries
        WHERE tenant_id = $1::uuid AND delivery_id = $2::uuid
        FOR UPDATE`,
      [input.tenantId, input.deliveryId],
    );
    const current = mapRequired(currentResult.rows[0]);

    const updatedResult = await this.#client.query<DeliveryRow>(
      `UPDATE platform.communication_deliveries
          SET attempt_count = attempt_count + 1,
              last_reason_code = $3,
              last_reason = $4,
              last_attempt_at = $5,
              updated_at = $5
        WHERE tenant_id = $1::uuid AND delivery_id = $2::uuid
        RETURNING ${DELIVERY_COLUMNS}`,
      [
        input.tenantId,
        input.deliveryId,
        input.reasonCode,
        input.reason ?? null,
        input.occurredAt,
      ],
    );
    const updated = mapRequired(updatedResult.rows[0]);

    await this.#client.query(
      `INSERT INTO platform.communication_delivery_events (
         delivery_id, tenant_id, from_state, to_state, reason_code, reason,
         occurred_at, attempt_token
       ) VALUES ($1::uuid, $2::uuid, $3, $3, $4, $5, $6, $7::uuid)`,
      [
        input.deliveryId,
        input.tenantId,
        current.state,
        input.reasonCode,
        input.reason ?? null,
        input.occurredAt,
        input.attemptToken ?? null,
      ],
    );

    return updated;
  }

  async applyTransition(
    input: ApplyCommunicationDeliveryTransitionInput,
  ): Promise<ApplyCommunicationDeliveryTransitionResult> {
    const currentResult = await this.#client.query<DeliveryRow>(
      `SELECT ${DELIVERY_COLUMNS}
         FROM platform.communication_deliveries
        WHERE tenant_id = $1::uuid AND delivery_id = $2::uuid
        FOR UPDATE`,
      [input.tenantId, input.deliveryId],
    );
    const currentRow = currentResult.rows[0];
    if (currentRow === undefined) throw new Error('COMMUNICATION_DELIVERY_NOT_FOUND');
    const current = mapDelivery(currentRow);

    if (input.transition.providerEventId !== undefined) {
      const duplicate = await this.#client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM platform.communication_delivery_events
            WHERE tenant_id = $1::uuid AND provider_event_id = $2
         ) AS exists`,
        [input.tenantId, input.transition.providerEventId],
      );
      if (duplicate.rows[0]?.exists === true) return { applied: false, delivery: current };
    }

    if (current.state === input.transition.to) return { applied: false, delivery: current };
    if (input.transition.from !== current.state) {
      throw new Error(
        `COMMUNICATION_DELIVERY_STALE_FROM_STATE:${input.transition.from}->${current.state}`,
      );
    }
    assertDeliveryTransition(current.state, input.transition.to);

    const updatedResult = await this.#client.query<DeliveryRow>(
      `UPDATE platform.communication_deliveries
          SET state = $3,
              provider_message_id = COALESCE($4, provider_message_id),
              attempt_count = attempt_count + $5,
              last_reason_code = $6,
              last_reason = $7,
              accepted_at = CASE WHEN $3 = 'ACCEPTED' THEN COALESCE(accepted_at, $8) ELSE accepted_at END,
              last_attempt_at = CASE WHEN $5 = 1 THEN $8 ELSE last_attempt_at END,
              updated_at = $8
        WHERE tenant_id = $1::uuid AND delivery_id = $2::uuid
        RETURNING ${DELIVERY_COLUMNS}`,
      [
        input.tenantId,
        input.deliveryId,
        input.transition.to,
        input.providerMessageId ?? null,
        input.incrementAttempt === true ? 1 : 0,
        input.transition.reasonCode ?? null,
        input.transition.reason ?? null,
        input.transition.occurredAt,
      ],
    );
    const updated = mapRequired(updatedResult.rows[0]);

    await this.#client.query(
      `INSERT INTO platform.communication_delivery_events (
         delivery_id, tenant_id, from_state, to_state, provider_event_id,
         reason_code, reason, occurred_at, attempt_token
       ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::uuid)`,
      [
        input.deliveryId,
        input.tenantId,
        current.state,
        input.transition.to,
        input.transition.providerEventId ?? null,
        input.transition.reasonCode ?? null,
        input.transition.reason ?? null,
        input.transition.occurredAt,
        input.attemptToken ?? null,
      ],
    );

    return { applied: true, delivery: updated };
  }
}

function mapRequired(row: DeliveryRow | undefined): CommunicationDeliveryRecord {
  if (row === undefined) throw new Error('COMMUNICATION_DELIVERY_WRITE_FAILED');
  return mapDelivery(row);
}

function mapDelivery(row: DeliveryRow): CommunicationDeliveryRecord {
  return {
    deliveryId: row.delivery_id,
    tenantId: row.tenant_id,
    ...(row.organization_id === null ? {} : { organizationId: row.organization_id }),
    idempotencyKey: row.idempotency_key,
    channel: row.channel,
    connectorKey: row.connector_key,
    adapterKey: row.adapter_key,
    ...(row.provider_message_id === null ? {} : { providerMessageId: row.provider_message_id }),
    state: row.state,
    attemptCount: row.attempt_count,
    ...(row.last_reason_code === null ? {} : { lastReasonCode: row.last_reason_code }),
    ...(row.last_reason === null ? {} : { lastReason: row.last_reason }),
    requestedAt: toIso(row.requested_at),
    ...(row.accepted_at === null ? {} : { acceptedAt: toIso(row.accepted_at) }),
    updatedAt: toIso(row.updated_at),
    ...(row.dispatch_snapshot === null ? {} : { dispatchSnapshot: row.dispatch_snapshot }),
    ...(row.next_attempt_at === null ? {} : { nextAttemptAt: toIso(row.next_attempt_at) }),
    ...(row.last_attempt_at === null ? {} : { lastAttemptAt: toIso(row.last_attempt_at) }),
    ...(row.claim_token === null ? {} : { claimToken: row.claim_token }),
    ...(row.claim_expires_at === null ? {} : { claimExpiresAt: toIso(row.claim_expires_at) }),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
