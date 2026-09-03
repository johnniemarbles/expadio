import type { PoolClient } from 'pg';
import { reconcileCommunicationCertification } from './communication-certification-reconciliation.ts';

export type CommunicationProviderWebhookOutcome =
  | 'SENT'
  | 'DELIVERED'
  | 'BOUNCED'
  | 'COMPLAINED'
  | 'FAILED'
  | 'IGNORED'
  | 'UNMATCHED';

type ProviderLifecycleOutcome = Exclude<CommunicationProviderWebhookOutcome, 'IGNORED' | 'UNMATCHED'>;

export type CommunicationDeliveryLifecycleState =
  | 'PENDING'
  | 'ACCEPTED'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED'
  | 'BOUNCED'
  | 'COMPLAINED'
  | 'CANCELLED';

export type CommunicationWebhookProviderKey =
  | 'resend'
  | 'twilio-sms'
  | 'twilio-whatsapp'
  | 'twilio-voice';

export interface VerifiedCommunicationProviderWebhook {
  readonly tenantId: string;
  readonly providerKey: CommunicationWebhookProviderKey;
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

export interface CommunicationProviderWebhookTransition {
  readonly previousState: CommunicationDeliveryLifecycleState;
  readonly outcome: Exclude<CommunicationProviderWebhookOutcome, 'UNMATCHED'>;
  readonly nextState: CommunicationDeliveryLifecycleState;
  readonly applied: boolean;
  readonly reasonCode: string;
}

interface DeliveryRow {
  readonly delivery_id: string;
  readonly state: CommunicationDeliveryLifecycleState;
  readonly provider_message_id: string | null;
}

interface WebhookEventRow {
  readonly webhook_event_id: string;
  readonly normalized_outcome: CommunicationProviderWebhookOutcome;
  readonly delivery_id: string | null;
  readonly previous_delivery_state: CommunicationDeliveryLifecycleState | null;
  readonly new_delivery_state: CommunicationDeliveryLifecycleState | null;
  readonly reason_code: string;
}

const PROVIDER_LIFECYCLE_TRANSITIONS: Record<
  CommunicationDeliveryLifecycleState,
  Partial<Record<ProviderLifecycleOutcome, CommunicationDeliveryLifecycleState>>
> = {
  PENDING: {
    SENT: 'SENT', DELIVERED: 'DELIVERED', FAILED: 'FAILED', BOUNCED: 'BOUNCED', COMPLAINED: 'COMPLAINED',
  },
  ACCEPTED: {
    SENT: 'SENT', DELIVERED: 'DELIVERED', FAILED: 'FAILED', BOUNCED: 'BOUNCED', COMPLAINED: 'COMPLAINED',
  },
  SENT: {
    DELIVERED: 'DELIVERED', FAILED: 'FAILED', BOUNCED: 'BOUNCED', COMPLAINED: 'COMPLAINED',
  },
  FAILED: {
    DELIVERED: 'DELIVERED', BOUNCED: 'BOUNCED', COMPLAINED: 'COMPLAINED',
  },
  DELIVERED: { BOUNCED: 'BOUNCED', COMPLAINED: 'COMPLAINED' },
  BOUNCED: { COMPLAINED: 'COMPLAINED' },
  COMPLAINED: {},
  CANCELLED: {},
};

function nonBlank(value: string, code: string): string {
  const normalized = value.trim();
  if (normalized === '' || /[\r\n\t]/u.test(normalized)) throw new Error(code);
  return normalized;
}

/** Provider-specific callback vocabulary is collapsed into the canonical lifecycle here. */
export function normalizeCommunicationProviderWebhook(
  webhook: Pick<VerifiedCommunicationProviderWebhook, 'providerKey' | 'eventType'>,
): Exclude<CommunicationProviderWebhookOutcome, 'UNMATCHED'> {
  if (webhook.providerKey === 'resend') {
    switch (webhook.eventType) {
      case 'email.sent': return 'SENT';
      case 'email.delivered': return 'DELIVERED';
      case 'email.bounced': return 'BOUNCED';
      case 'email.complained': return 'COMPLAINED';
      case 'email.delivery_delayed': return 'FAILED';
      default: return 'IGNORED';
    }
  }

  const eventType = webhook.eventType.trim().toUpperCase();
  if (
    webhook.providerKey === 'twilio-sms'
    || webhook.providerKey === 'twilio-whatsapp'
    || webhook.providerKey === 'twilio-voice'
  ) {
    switch (eventType) {
      case 'SENT': return 'SENT';
      case 'DELIVERED': return 'DELIVERED';
      case 'FAILED': return 'FAILED';
      default: return 'IGNORED';
    }
  }

  return 'IGNORED';
}

function outcomeAlreadyReflected(
  current: CommunicationDeliveryLifecycleState,
  outcome: Exclude<CommunicationProviderWebhookOutcome, 'UNMATCHED'>,
): boolean {
  if (outcome === 'IGNORED') return true;
  return current === outcome;
}

export function resolveCommunicationProviderWebhookTransition(
  current: CommunicationDeliveryLifecycleState,
  outcome: Exclude<CommunicationProviderWebhookOutcome, 'UNMATCHED'>,
): CommunicationProviderWebhookTransition {
  if (outcome === 'IGNORED') {
    return {
      previousState: current, outcome, nextState: current, applied: false,
      reasonCode: 'PROVIDER_WEBHOOK_IGNORED',
    };
  }

  const nextState = PROVIDER_LIFECYCLE_TRANSITIONS[current][outcome];
  if (nextState === undefined) {
    return {
      previousState: current,
      outcome,
      nextState: current,
      applied: false,
      reasonCode: outcomeAlreadyReflected(current, outcome)
        ? 'PROVIDER_WEBHOOK_STATE_ALREADY_APPLIED'
        : 'PROVIDER_WEBHOOK_STATE_TRANSITION_IGNORED',
    };
  }

  return {
    previousState: current,
    outcome,
    nextState,
    applied: nextState !== current,
    reasonCode: `PROVIDER_WEBHOOK_${outcome}`,
  };
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
      `SELECT webhook_event_id, normalized_outcome, delivery_id, previous_delivery_state,
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

    const outcome: CommunicationProviderWebhookOutcome = delivery === undefined ? 'UNMATCHED' : providerOutcome;
    const transition = delivery === undefined
      ? null
      : resolveCommunicationProviderWebhookTransition(delivery.state, providerOutcome);
    const previousState = transition?.previousState ?? null;
    const nextState = transition?.nextState ?? null;
    const reasonCode = transition?.reasonCode ?? 'PROVIDER_WEBHOOK_UNMATCHED';
    const processedAt = new Date();

    if (delivery !== undefined && transition?.applied === true) {
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
          tenantId, delivery.delivery_id, transition.previousState, transition.nextState,
          reasonCode, `Provider webhook ${eventType} applied.`, processedAt,
        ],
      );
      if (updated.rowCount !== 1) throw new Error('PROVIDER_WEBHOOK_DELIVERY_UPDATE_CONFLICT');

      await client.query(
        `INSERT INTO platform.communication_delivery_events (
           delivery_id, tenant_id, from_state, to_state, provider_event_id,
           reason_code, reason, occurred_at
         ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::timestamptz)`,
        [
          delivery.delivery_id, tenantId, transition.previousState, transition.nextState,
          providerEventId, reasonCode, `Provider webhook ${eventType} applied.`, webhook.receivedAt,
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
       RETURNING webhook_event_id, normalized_outcome, delivery_id, previous_delivery_state,
                 new_delivery_state, reason_code`,
      [
        tenantId, webhook.providerKey, connectorKey, providerEventId,
        providerMessageId, eventType, outcome, delivery?.delivery_id ?? null,
        previousState, nextState, reasonCode, JSON.stringify(webhook.payload),
        webhook.receivedAt, processedAt,
      ],
    );
    const row = inserted.rows[0];
    if (row === undefined) throw new Error('PROVIDER_WEBHOOK_EVENT_INSERT_FAILED');

    if (
      delivery !== undefined
      && transition?.applied === true
      && (
        transition.nextState === 'DELIVERED'
        || transition.nextState === 'BOUNCED'
        || transition.nextState === 'COMPLAINED'
        || transition.nextState === 'FAILED'
        || transition.nextState === 'CANCELLED'
      )
    ) {
      await reconcileCommunicationCertification(client, {
        tenantId,
        deliveryId: delivery.delivery_id,
        webhookEventId: row.webhook_event_id,
        finalDeliveryState: transition.nextState,
      });
    }

    await client.query('COMMIT');
    return toResult('RECORDED', row);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
