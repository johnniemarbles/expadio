/**
 * OTP delivery — sends the PUBLIC-rail verification code through the governed
 * Communications fabric.
 *
 * The plaintext code exists only at ingest (the challenge stores a salted hash),
 * so delivery is triggered inline right after capture commits. It runs in its own
 * guarded transaction: a delivery failure (no provider configured, suppressed
 * recipient, missing template) must NEVER roll back or fail the capture — the
 * lead is already safely parked. The code travels only as a template variable and
 * is never logged.
 *
 * This queues a durable delivery; the existing communication delivery worker
 * performs the actual provider send. Sending therefore requires the tenant to
 * have an email provider connector bound for `communication.email.send`; until
 * then this degrades to a logged reason code (e.g. NOT_CONFIGURED).
 */
import { queueGovernedCommunicateAction } from '@expadio/communication/governed-action-adapter';
import { PostgresCommunicationConsentRepository } from '@expadio/postgres-runtime/consent';
import { PostgresCommunicationDeliveryRepository } from '@expadio/postgres-runtime/delivery';
import { PostgresCommunicationSuppressionRepository } from '@expadio/postgres-runtime/suppression';
import { PostgresCommunicationTemplateRepository } from '@expadio/postgres-runtime/template';
import { PostgresProviderRegistryRepository } from '@expadio/postgres-runtime/provider-registry';
import { dbPool } from './iam-adapter';
import {
  OTP_CAPABILITY_KEY,
  OTP_SMS_CAPABILITY_KEY,
  OTP_WHATSAPP_CAPABILITY_KEY,
  buildOtpCommunicateIntent,
  buildSmsOtpCommunicateIntent,
} from './lead-capture-otp-intent';

export interface CaptureOtpDelivery {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly captureLeadId: string;
  readonly channel: 'EMAIL' | 'SMS' | 'WHATSAPP';
  /** Plaintext code — passed to the fabric as a variable, never persisted or logged. */
  readonly code: string;
  /** Raw destination (email address or phone number). Only the hash is persisted on the challenge. */
  readonly destination: string;
}

export type CaptureOtpDeliveryResult =
  | { readonly dispatched: true; readonly deliveryId: string }
  | { readonly dispatched: false; readonly reasonCode: string };

/**
 * Best-effort inline dispatch. Returns a result for observability but never
 * throws — the caller has already committed the capture.
 */
export async function deliverCaptureOtp(delivery: CaptureOtpDelivery): Promise<CaptureOtpDeliveryResult> {
  const capabilityKey =
    delivery.channel === 'SMS' ? OTP_SMS_CAPABILITY_KEY :
    delivery.channel === 'WHATSAPP' ? OTP_WHATSAPP_CAPABILITY_KEY :
    OTP_CAPABILITY_KEY;

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [delivery.tenantId]);

    const providers = new PostgresProviderRegistryRepository(client);
    const connectors = await providers.listConnectors(delivery.tenantId, capabilityKey);
    const routingPolicy = await providers.loadRoutingPolicy(delivery.tenantId, capabilityKey);

    const intent = delivery.channel === 'EMAIL'
      ? buildOtpCommunicateIntent({
          tenantId: delivery.tenantId,
          organizationId: delivery.organizationId,
          captureLeadId: delivery.captureLeadId,
          recipientEmail: delivery.destination,
          code: delivery.code,
        })
      : buildSmsOtpCommunicateIntent({
          tenantId: delivery.tenantId,
          organizationId: delivery.organizationId,
          captureLeadId: delivery.captureLeadId,
          recipientPhone: delivery.destination,
          code: delivery.code,
          channel: delivery.channel,
        });

    const queue = await queueGovernedCommunicateAction(intent, {
      compliance: {
        consent: new PostgresCommunicationConsentRepository(client),
        suppression: new PostgresCommunicationSuppressionRepository(client),
      },
      templates: new PostgresCommunicationTemplateRepository(client),
      delivery: new PostgresCommunicationDeliveryRepository(client),
      connectors,
      ...(routingPolicy === null ? {} : { routingPolicy }),
    });

    await client.query('COMMIT');

    if (queue.queued) {
      return { dispatched: true, deliveryId: queue.delivery.deliveryId };
    }
    // Not queued is an expected steady state before a provider is configured.
    // Log only the reason code — never the code or recipient.
    console.warn(`Capture OTP not dispatched (${queue.reasonCode}) for capture lead ${delivery.captureLeadId}.`);
    return { dispatched: false, reasonCode: queue.reasonCode };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.warn(`Capture OTP dispatch errored for capture lead ${delivery.captureLeadId}:`, error instanceof Error ? error.message : error);
    return { dispatched: false, reasonCode: 'DISPATCH_ERROR' };
  } finally {
    client.release();
  }
}
