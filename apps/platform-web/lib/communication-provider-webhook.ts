import type { PoolClient } from 'pg';

export type CommunicationProviderWebhookOutcome =
  | 'SENT'
  | 'DELIVERED'
  | 'BOUNCED'
  | 'COMPLAINED'
  | 'FAILED'
  | 'IGNORED'
  | 'UNMATCHED';

export type CommunicationDeliveryLifecycleState =
  | 'PENDING'
  | 'ACCEPTED'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED'
  | 'BOUNCED'
  | 'COMPLAINED'
  | 'CANCELLED';

export interface VerifiedCommunicationProviderWebhook {
  readonly tenantId: string;
  readonly providerKey: 'resend';
  readonly connectorKey: string;
  readonly providerEventId: string;
  readonly providerMessageId: string | null;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly receivedAt: Date;
}

export interface CommunicationProviderWebhookIngestionResult {
  readonly status: 'RECORDED' | 'DUPLICATE';
  readonly normalizedOutcome: CommunicationProviderWebhookOutcome;
  readonly deliveryId: string | null;
  readonly previousDeliveryState: CommunicationDeliveryLifecycleState | null;
  readonly newDeliveryState: CommunicationDeliveryLifecycleState | null;
  readonly reasonCode: string;
}

interface DeliveryRow {
  readonly delivery_id: string;
  readonly state: CommunicationDeliveryLifecycleState;
  readonly provider_message_id: string | null;
}

interface WebhookEventRow {
  readonly normalized_outcome: CommunicationProviderWebhookOutcome;
  readonly delivery_id: string | null;
  readonly previous_delivery_state: CommunicationDeliveryLifecycleState | null;
  readonly new_delivery_state: CommunicationDeliveryLifecycleState | null;
  readonly reason_code: string;
}

function nonBlank(value: string, code: string): string {
  const normalized = value.trim();
  if (normalized === '' || /[\r\n\t]/u.test(normalized)) throw new Error(code);
  return normalized;
}

export function normalizeCommunicationProviderWebhook(
  webhook: Pick<VerifiedCommunicationProviderWebhook, 'providerKey' | 'eventType'>,
): Exclude<CommunicationProviderWebhookOutcome, 'UNMATCHED'> {
  if (webhook.providerKey !== 'resend') return 'IGNORED';
  switch (webhook.eventType) {
    case 'email.sent':
      return 'SENT';
    case 'email.delivered':
      return 'DELIVERED';
    case 'email.bounced':
      return 'BOUNCED';
    case 'email.complained':
      return 'COMPLAINED';
    case 'email.delivery_delayed':
      return 'FAILED';
    default:
      return 'IGNORED';
  }
}

function targetState(
  current: CommunicationDeliveryLifecycleState,
  outcome: Exclude<CommunicationProviderWebhookOutcome, 'UNMATCHED'>,
): CommunicationDeliveryLifecycleState {
  if (outcome === 'IGNORED') return current;
  if (current === 'CANCELLED') return current;
  if (outcome === 'SENT') {
    return current === 'PENDING' || current === 'ACCEPTED' ? 'SENT' : current;
  }
  if (outcome === 'DELIVERED') {
    return current === 'PENDING' || current === 'ACCEPTED' || current === 'SENT'
      ? 'DELIVERED'
      : current;
  }
  return outcome;
}

function reasonFor(
  outcome: CommunicationProviderWebhookOutcome,
  previous: CommunicationDeliveryLifecycleState | null,
  next: CommunicationDeliveryLifecycleState | null,
): string {
  if (outcome === 'UNMATCHED') return 'PROVIDER_WEBHOOK_UNMATCHED';
  if (outcome === 'IGNORED') return 'PROVIDER_WEBHOOK_IGNORED';
  if (previous !== null && next !== null && previous === next) return 'PROVIDER_WEBHOOK_STATE_ALREADY_APPLIED';
  return `PROVIDER_WEBHOOK_${outcome}`;
}

function toResult(status: 'RECORDED' | 'DUPLICATE', row: WebhookEventRow): CommunicationProviderWebhookIngestionResult {
  return {
    status,
    normalizedOutcome: row.normalized_outcome,
    deliveryId: row.delivery_id,
    previousDeliveryState: row.previous_delivery_state,
    newDeliveryState: row.new_delivery_state,
    reasonCode: row.reason_code,
  };
}

export async function ingestVerifiedCommunicationProviderWebhook(
  client: PoolClient,
  webhook: VerifiedCommunicationProviderWebhook,
): Promise<CommunicationProviderWebhookIngestionResult> {
  const tenantId = nonBlank(webhook.tenantId, 'PROVIDER_WEBHOOK_TENANT_REQUIRED');
  const connectorKey = nonBlank(webhook.connectorKey, 'PROVIDER_WEBHOOK_CONNECTOR_REQUIRED');
  const providerEventId = nonBlank(webhook.providerEventId, 'PROVIDER_WEBHOOK_EVENT_ID_REQUIRED');
  const eventType = nonBlank(webhook.eventType, 'PROVIDER_WEBHOOK_EVENT_TYPE_REQUIRED');
  const providerMessageId = webhook.providerMessageId?.trim() || null;

  await client.query('BEGIN');
  try {
    const duplicate = await client.query<WebhookEventRow>(
      `SELECT normalized_outcome, delivery_id, previous_delivery_state,
              new_delivery_state, reason_code
         FROM platform.communication_provider_webhook_events
        WHERE tenant_id = $1::uuid
          AND provider_key = $2
          AND provider_event_id = $3
        LIMIT 1`,
      [tenantId, webhook.providerKey, providerEventId],
    );
    const existing = duplicate.rows[0];
    if (existing !== undefined) {
      await client.query('COMMIT');
      return toResult('DUPLICATE', existing);
    }

    const providerOutcome = normalizeCommunicationProviderWebhook(webhook);
    let delivery: DeliveryRow | undefined;
    if (providerMessageId !== null) {
      const deliveryResult = await client.query<DeliveryRow>(
        `SELECT delivery_id, state, provider_message_id
           FROM platform.communication_deliveries
          WHERE tenant_id = $1::uuid
            AND connector_key = $2
            AND provider_message_id = $3
          ORDER BY requested_at DESC, delivery_id DESC
          LIMIT 1
          FOR UPDATE`,
        [tenantId, connectorKey, providerMessageId],
      );
      delivery = deliveryResult.rows[0];
    }

    const outcome: CommunicationProviderWebhookOutcome = delivery === undefined
      ? 'UNMATCHED'
      : providerOutcome;

    const previousState = delivery?.state ?? null;
    const nextState = delivery === undefined
      ? null
      : targetState(delivery.state, providerOutcome);
    const reasonCode = reasonFor(outcome, previousState, nextState);
    const processedAt = new Date();

    if (delivery !== undefined && nextState !== null && nextState !== previousState) {
      const updated = await client.query(
        `UPDATE platform.communication_deliveries
            SET state = $4,
                last_reason_code = $5,
                last_reason = $6,
                updated_at = $7::timestamptz,
                claim_token = NULL,
                claim_expires_at = NULL
          WHERE tenant_id = $1::uuid
            AND delivery_id = $2::uuid
            AND state = $3`,
        [
          tenantId,
          delivery.delivery_id,
          previousState,
          nextState,
          reasonCode,
          `Provider webhook ${eventType} applied.`,
          processedAt,
        ],
      );
      if (updated.rowCount !== 1) throw new Error('PROVIDER_WEBHOOK_DELIVERY_UPDATE_CONFLICT');

      await client.query(
        `INSERT INTO platform.communication_delivery_events (
           delivery_id, tenant_id, from_state, to_state, provider_event_id,
           reason_code, reason, occurred_at
         ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::timestamptz)`,
        [
          delivery.delivery_id,
          tenantId,
          previousState,
          nextState,
          providerEventId,
          reasonCode,
          `Provider webhook ${eventType} applied.`,
          webhook.receivedAt,
        ],
      );
    }

    const inserted = await client.query<WebhookEventRow>(
      `INSERT INTO platform.communication_provider_webhook_events (
         tenant_id, provider_key, connector_key, provider_event_id,
         provider_message_id, event_type, normalized_outcome,
         delivery_id, previous_delivery_state, new_delivery_state,
         reason_code, payload, received_at, processed_at
       ) VALUES (
         $1::uuid, $2, $3, $4, $5, $6, $7,
         $8::uuid, $9, $10, $11, $12::jsonb, $13::timestamptz, $14::timestamptz
       )
       RETURNING normalized_outcome, delivery_id, previous_delivery_state,
                 new_delivery_state, reason_code`,
      [
        tenantId,
        webhook.providerKey,
        connectorKey,
        providerEventId,
        providerMessageId,
        eventType,
        outcome,
        delivery?.delivery_id ?? null,
        previousState,
        nextState,
        reasonCode,
        JSON.stringify(webhook.payload),
        webhook.receivedAt,
        processedAt,
      ],
    );
    const row = inserted.rows[0];
    if (row === undefined) throw new Error('PROVIDER_WEBHOOK_EVENT_INSERT_FAILED');

    await client.query('COMMIT');
    return toResult('RECORDED', row);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
