import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  evaluatePersistedCommunicationPreflight,
} from '@expadio/communication/persisted-preflight';
import type {
  CommunicationDeliveryDispatchSnapshot,
} from '@expadio/communication/delivery-repository';
import {
  prepareCommunicationProviderSendRequest,
} from '@expadio/communication/provider-send-request';
import {
  governedResendApiTokenProvider,
} from '@expadio/communication/governed-resend-binding';
import {
  ResendEmailAdapter,
} from '@expadio/communication/resend-email-adapter';
import {
  PostgresCommunicationConsentRepository,
} from '@expadio/postgres-runtime/consent';
import {
  PostgresCommunicationSuppressionRepository,
} from '@expadio/postgres-runtime/suppression';
import {
  PostgresCommunicationSenderRepository,
} from '@expadio/postgres-runtime/sender';
import {
  PostgresConnectorCredentialRepository,
  PostgresProviderRegistryRepository,
} from '@expadio/postgres-runtime/provider-registry';
import {
  createGovernedCredentialLeaseRuntime,
} from '@expadio/postgres-runtime/governed-credential-lease-runtime';
import {
  delegatedSecretResolver,
} from './vault-secret-resolver';

const DEFAULT_LEASE_MS = 120_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const NO_ORGANIZATION_AUTH_CONTEXT = '00000000-0000-0000-0000-000000000000';

interface DeliveryClaimRow {
  readonly delivery_id: string;
  readonly tenant_id: string;
  readonly organization_id: string | null;
  readonly idempotency_key: string;
  readonly channel: string;
  readonly connector_key: string;
  readonly adapter_key: string;
  readonly attempt_count: number;
  readonly dispatch_snapshot: CommunicationDeliveryDispatchSnapshot;
}

export interface CommunicationDeliveryClaim {
  readonly deliveryId: string;
  readonly tenantId: string;
  readonly organizationId: string | null;
  readonly idempotencyKey: string;
  readonly channel: string;
  readonly connectorKey: string;
  readonly adapterKey: string;
  readonly attemptCount: number;
  readonly claimToken: string;
  readonly claimExpiresAt: Date;
  readonly snapshot: CommunicationDeliveryDispatchSnapshot;
}

export type CommunicationDeliveryWorkerResult =
  | { readonly status: 'IDLE' }
  | {
      readonly status:
        | 'ACCEPTED'
        | 'RETRY_SCHEDULED'
        | 'FAILED'
        | 'CANCELLED'
        | 'STALE_CLAIM';
      readonly deliveryId: string;
      readonly reasonCode: string;
    };

export interface CommunicationDeliveryWorkerOptions {
  readonly serviceSubjectId: string;
  readonly now?: () => Date;
  readonly leaseMs?: number;
  readonly maxAttempts?: number;
  readonly fetchImpl?: typeof fetch;
}

function stableServiceSubject(value: string): string {
  const normalized = value.trim();
  if (normalized === '' || /[\r\n\t]/u.test(normalized)) {
    throw new Error('COMMUNICATION_WORKER_SERVICE_SUBJECT_INVALID');
  }
  return normalized;
}

export async function claimNextCommunicationDelivery(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly now?: Date;
    readonly leaseMs?: number;
  },
): Promise<CommunicationDeliveryClaim | null> {
  const now = input.now ?? new Date();
  const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error('COMMUNICATION_DELIVERY_LEASE_INVALID');
  }
  const claimToken = randomUUID();
  const claimExpiresAt = new Date(now.getTime() + leaseMs);

  await client.query('BEGIN');
  try {
    const candidate = await client.query<DeliveryClaimRow>(
      `SELECT delivery_id, tenant_id, organization_id, idempotency_key,
              channel, connector_key, adapter_key, attempt_count,
              dispatch_snapshot
         FROM platform.communication_deliveries
        WHERE tenant_id = $1::uuid
          AND state = 'PENDING'
          AND dispatch_snapshot IS NOT NULL
          AND next_attempt_at <= $2::timestamptz
          AND (claim_token IS NULL OR claim_expires_at <= $2::timestamptz)
        ORDER BY next_attempt_at ASC, requested_at ASC, delivery_id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
      [input.tenantId, now],
    );
    const row = candidate.rows[0];
    if (row === undefined) {
      await client.query('ROLLBACK');
      return null;
    }

    const updated = await client.query(
      `UPDATE platform.communication_deliveries
          SET claim_token = $3::uuid,
              claim_expires_at = $4::timestamptz,
              updated_at = $2::timestamptz
        WHERE tenant_id = $1::uuid
          AND delivery_id = $5::uuid
          AND state = 'PENDING'`,
      [input.tenantId, now, claimToken, claimExpiresAt, row.delivery_id],
    );
    if (updated.rowCount !== 1) {
      throw new Error('COMMUNICATION_DELIVERY_CLAIM_FAILED');
    }

    await client.query(
      `INSERT INTO platform.communication_delivery_events (
         delivery_id, tenant_id, from_state, to_state, reason_code, reason,
         occurred_at, attempt_token
       ) VALUES (
         $1::uuid, $2::uuid, 'PENDING', 'PENDING',
         'DELIVERY_CLAIMED', 'Delivery claimed by the provider worker.',
         $3::timestamptz, $4::uuid
       )`,
      [row.delivery_id, input.tenantId, now, claimToken],
    );

    await client.query('COMMIT');
    return {
      deliveryId: row.delivery_id,
      tenantId: row.tenant_id,
      organizationId: row.organization_id,
      idempotencyKey: row.idempotency_key,
      channel: row.channel,
      connectorKey: row.connector_key,
      adapterKey: row.adapter_key,
      attemptCount: row.attempt_count,
      claimToken,
      claimExpiresAt,
      snapshot: row.dispatch_snapshot,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

function validateSnapshot(claim: CommunicationDeliveryClaim): void {
  const dispatch = claim.snapshot?.dispatch;
  if (
    dispatch === undefined
    || dispatch.tenantId !== claim.tenantId
    || dispatch.idempotencyKey !== claim.idempotencyKey
    || dispatch.channel !== claim.channel
  ) {
    throw new Error('COMMUNICATION_DELIVERY_SNAPSHOT_INVALID');
  }
}

async function finalizeClaim(
  client: PoolClient,
  input: {
    readonly claim: CommunicationDeliveryClaim;
    readonly now: Date;
    readonly toState: 'ACCEPTED' | 'FAILED' | 'CANCELLED';
    readonly reasonCode: string;
    readonly reason: string | null;
    readonly providerMessageId?: string;
  },
): Promise<boolean> {
  await client.query('BEGIN');
  try {
    const result = await client.query(
      `UPDATE platform.communication_deliveries
          SET state = $4,
              provider_message_id = COALESCE($5, provider_message_id),
              attempt_count = attempt_count + 1,
              last_attempt_at = $6::timestamptz,
              last_reason_code = $7,
              last_reason = $8,
              accepted_at = CASE
                WHEN $4 = 'ACCEPTED' THEN COALESCE(accepted_at, $6::timestamptz)
                ELSE accepted_at
              END,
              claim_token = NULL,
              claim_expires_at = NULL,
              updated_at = $6::timestamptz
        WHERE tenant_id = $1::uuid
          AND delivery_id = $2::uuid
          AND state = 'PENDING'
          AND claim_token = $3::uuid
          AND claim_expires_at > $6::timestamptz`,
      [
        input.claim.tenantId,
        input.claim.deliveryId,
        input.claim.claimToken,
        input.toState,
        input.providerMessageId ?? null,
        input.now,
        input.reasonCode,
        input.reason,
      ],
    );
    if (result.rowCount !== 1) {
      await client.query('ROLLBACK');
      return false;
    }

    await client.query(
      `INSERT INTO platform.communication_delivery_events (
         delivery_id, tenant_id, from_state, to_state, reason_code, reason,
         occurred_at, attempt_token
       ) VALUES ($1::uuid, $2::uuid, 'PENDING', $3, $4, $5, $6::timestamptz, $7::uuid)`,
      [
        input.claim.deliveryId,
        input.claim.tenantId,
        input.toState,
        input.reasonCode,
        input.reason,
        input.now,
        input.claim.claimToken,
      ],
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function rescheduleClaim(
  client: PoolClient,
  input: {
    readonly claim: CommunicationDeliveryClaim;
    readonly now: Date;
    readonly reasonCode: string;
    readonly reason: string | null;
    readonly retryAfterMs?: number;
    readonly maxAttempts: number;
  },
): Promise<'RETRY_SCHEDULED' | 'FAILED' | 'STALE_CLAIM'> {
  const nextAttemptNumber = input.claim.attemptCount + 1;
  if (nextAttemptNumber >= input.maxAttempts) {
    const finalized = await finalizeClaim(client, {
      claim: input.claim,
      now: input.now,
      toState: 'FAILED',
      reasonCode: 'DELIVERY_RETRIES_EXHAUSTED',
      reason: input.reason ?? input.reasonCode,
    });
    return finalized ? 'FAILED' : 'STALE_CLAIM';
  }

  const fallbackDelay = Math.min(300_000, 1_000 * (2 ** nextAttemptNumber));
  const delayMs = Math.max(1_000, input.retryAfterMs ?? fallbackDelay);
  const nextAttemptAt = new Date(input.now.getTime() + delayMs);

  await client.query('BEGIN');
  try {
    const result = await client.query(
      `UPDATE platform.communication_deliveries
          SET attempt_count = attempt_count + 1,
              last_attempt_at = $4::timestamptz,
              last_reason_code = $5,
              last_reason = $6,
              next_attempt_at = $7::timestamptz,
              claim_token = NULL,
              claim_expires_at = NULL,
              updated_at = $4::timestamptz
        WHERE tenant_id = $1::uuid
          AND delivery_id = $2::uuid
          AND state = 'PENDING'
          AND claim_token = $3::uuid
          AND claim_expires_at > $4::timestamptz`,
      [
        input.claim.tenantId,
        input.claim.deliveryId,
        input.claim.claimToken,
        input.now,
        input.reasonCode,
        input.reason,
        nextAttemptAt,
      ],
    );
    if (result.rowCount !== 1) {
      await client.query('ROLLBACK');
      return 'STALE_CLAIM';
    }

    await client.query(
      `INSERT INTO platform.communication_delivery_events (
         delivery_id, tenant_id, from_state, to_state, reason_code, reason,
         occurred_at, attempt_token
       ) VALUES (
         $1::uuid, $2::uuid, 'PENDING', 'PENDING', $3, $4,
         $5::timestamptz, $6::uuid
       )`,
      [
        input.claim.deliveryId,
        input.claim.tenantId,
        input.reasonCode,
        input.reason,
        input.now,
        input.claim.claimToken,
      ],
    );
    await client.query('COMMIT');
    return 'RETRY_SCHEDULED';
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function runCommunicationDeliveryWorkerOnce(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly options: CommunicationDeliveryWorkerOptions;
  },
): Promise<CommunicationDeliveryWorkerResult> {
  const serviceSubjectId = stableServiceSubject(input.options.serviceSubjectId);
  const now = input.options.now?.() ?? new Date();
  const maxAttempts = input.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const claim = await claimNextCommunicationDelivery(client, {
    tenantId: input.tenantId,
    now,
    ...(input.options.leaseMs === undefined ? {} : { leaseMs: input.options.leaseMs }),
  });
  if (claim === null) return { status: 'IDLE' };

  try {
    validateSnapshot(claim);
  } catch (error) {
    const finishedAt = input.options.now?.() ?? new Date();
    const applied = await finalizeClaim(client, {
      claim,
      now: finishedAt,
      toState: 'FAILED',
      reasonCode: 'DELIVERY_SNAPSHOT_INVALID',
      reason: error instanceof Error ? error.message : 'Invalid durable dispatch snapshot.',
    });
    return {
      status: applied ? 'FAILED' : 'STALE_CLAIM',
      deliveryId: claim.deliveryId,
      reasonCode: applied ? 'DELIVERY_SNAPSHOT_INVALID' : 'DELIVERY_CLAIM_LOST',
    };
  }

  const dispatch = claim.snapshot.dispatch;
  const preflightAt = input.options.now?.() ?? new Date();
  const preflight = await evaluatePersistedCommunicationPreflight({
    intent: {
      triggerKey: dispatch.triggerKey,
      tenantId: dispatch.tenantId,
      ...(dispatch.organizationId === undefined ? {} : { organizationId: dispatch.organizationId }),
      recipient: dispatch.recipient,
      variables: dispatch.rendered.variables,
      locale: dispatch.rendered.locale,
      idempotencyKey: dispatch.idempotencyKey,
      purpose: dispatch.purpose,
      consentRequired: claim.snapshot.consentRequired,
      channel: dispatch.channel,
    },
    repositories: {
      consent: new PostgresCommunicationConsentRepository(client),
      suppression: new PostgresCommunicationSuppressionRepository(client),
    },
    at: preflightAt.toISOString(),
  });

  if (!preflight.allowed) {
    const applied = await finalizeClaim(client, {
      claim,
      now: preflightAt,
      toState: 'CANCELLED',
      reasonCode: preflight.reasonCode,
      reason: preflight.reason,
    });
    return {
      status: applied ? 'CANCELLED' : 'STALE_CLAIM',
      deliveryId: claim.deliveryId,
      reasonCode: applied ? preflight.reasonCode : 'DELIVERY_CLAIM_LOST',
    };
  }

  try {
    const registry = new PostgresProviderRegistryRepository(client);
    const connectors = await registry.listConnectors(
      claim.tenantId,
      dispatch.routing.capabilityKey,
    );
    const selected = connectors.find(
      (connector) => connector.connectorKey === claim.connectorKey,
    );
    if (
      selected === undefined
      || !selected.enabled
      || selected.providerKey !== 'resend'
      || selected.providerType !== 'email'
      || claim.adapterKey !== 'resend-email-v1'
    ) {
      const status = await rescheduleClaim(client, {
        claim,
        now: input.options.now?.() ?? new Date(),
        reasonCode: 'DELIVERY_CONNECTOR_UNAVAILABLE',
        reason: 'The queued Resend connector is not currently executable.',
        maxAttempts,
      });
      return {
        status,
        deliveryId: claim.deliveryId,
        reasonCode: status === 'FAILED'
          ? 'DELIVERY_RETRIES_EXHAUSTED'
          : status === 'STALE_CLAIM'
            ? 'DELIVERY_CLAIM_LOST'
            : 'DELIVERY_CONNECTOR_UNAVAILABLE',
      };
    }

    const senderPrepared = await prepareCommunicationProviderSendRequest({
      dispatch,
      senderRepository: new PostgresCommunicationSenderRepository(client),
      platformFallback: 'DENY',
    });
    if (!senderPrepared.ok) {
      const status = await rescheduleClaim(client, {
        claim,
        now: input.options.now?.() ?? new Date(),
        reasonCode: senderPrepared.reasonCode,
        reason: 'A verified sender is not currently available.',
        maxAttempts,
      });
      return {
        status,
        deliveryId: claim.deliveryId,
        reasonCode: status === 'FAILED'
          ? 'DELIVERY_RETRIES_EXHAUSTED'
          : status === 'STALE_CLAIM'
            ? 'DELIVERY_CLAIM_LOST'
            : senderPrepared.reasonCode,
      };
    }

    const authOrganizationId =
      dispatch.organizationId ?? NO_ORGANIZATION_AUTH_CONTEXT;
    const leaseService = createGovernedCredentialLeaseRuntime({
      client,
      contextProvider: {
        async resolve() {
          return {
            subjectId: serviceSubjectId,
            actorKind: 'service',
            tenantId: claim.tenantId,
            organizationId: authOrganizationId,
          };
        },
      },
    });
    const adapter = new ResendEmailAdapter({
      apiToken: governedResendApiTokenProvider({
        connector: selected,
        credentialRepository: new PostgresConnectorCredentialRepository(client),
        leaseService,
        secretResolver: delegatedSecretResolver,
        requestedBySubjectId: serviceSubjectId,
        requestId: () => randomUUID(),
        correlationId: () => randomUUID(),
      }),
      ...(input.options.fetchImpl === undefined
        ? {}
        : { fetchImpl: input.options.fetchImpl }),
    });

    const providerAttemptAt = input.options.now?.() ?? new Date();
    const providerResult = await adapter.send({
      ...senderPrepared.request,
      requestedAt: providerAttemptAt.toISOString(),
    });
    const completedAt = input.options.now?.() ?? new Date();

    if (providerResult.status === 'ACCEPTED') {
      const applied = await finalizeClaim(client, {
        claim,
        now: completedAt,
        toState: 'ACCEPTED',
        reasonCode: 'PROVIDER_ACCEPTED',
        reason: null,
        providerMessageId: providerResult.providerMessageId,
      });
      return {
        status: applied ? 'ACCEPTED' : 'STALE_CLAIM',
        deliveryId: claim.deliveryId,
        reasonCode: applied ? 'PROVIDER_ACCEPTED' : 'DELIVERY_CLAIM_LOST',
      };
    }

    if (
      providerResult.status === 'RETRYABLE_FAILURE'
      || providerResult.reasonCode === 'AUTHENTICATION_FAILED'
    ) {
      const status = await rescheduleClaim(client, {
        claim,
        now: completedAt,
        reasonCode: providerResult.reasonCode,
        reason: providerResult.reason ?? null,
        ...(providerResult.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: providerResult.retryAfterMs }),
        maxAttempts,
      });
      return {
        status,
        deliveryId: claim.deliveryId,
        reasonCode: status === 'FAILED'
          ? 'DELIVERY_RETRIES_EXHAUSTED'
          : status === 'STALE_CLAIM'
            ? 'DELIVERY_CLAIM_LOST'
            : providerResult.reasonCode,
      };
    }

    const applied = await finalizeClaim(client, {
      claim,
      now: completedAt,
      toState: 'FAILED',
      reasonCode: providerResult.reasonCode,
      reason: providerResult.reason ?? null,
    });
    return {
      status: applied ? 'FAILED' : 'STALE_CLAIM',
      deliveryId: claim.deliveryId,
      reasonCode: applied ? providerResult.reasonCode : 'DELIVERY_CLAIM_LOST',
    };
  } catch (error) {
    const status = await rescheduleClaim(client, {
      claim,
      now: input.options.now?.() ?? new Date(),
      reasonCode: 'DELIVERY_EXECUTION_ERROR',
      reason: error instanceof Error ? error.message : 'Unknown communication execution error.',
      maxAttempts,
    });
    return {
      status,
      deliveryId: claim.deliveryId,
      reasonCode: status === 'FAILED'
        ? 'DELIVERY_RETRIES_EXHAUSTED'
        : status === 'STALE_CLAIM'
          ? 'DELIVERY_CLAIM_LOST'
          : 'DELIVERY_EXECUTION_ERROR',
    };
  }
}
