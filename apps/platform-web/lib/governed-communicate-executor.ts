import type { PoolClient } from 'pg';
import {
  governedActionExecutionAttemptKey,
  type PersistedGovernedActionExecutionAttempt,
} from '@expadio/governed-actions';
import {
  parseGovernedCommunicateConfiguration,
  queueGovernedCommunicateAction,
  type GovernedCommunicateQueueResult,
} from '@expadio/communication/governed-action-adapter';
import { PostgresCommunicationConsentRepository } from '@expadio/postgres-runtime/consent';
import { PostgresCommunicationDeliveryRepository } from '@expadio/postgres-runtime/delivery';
import {
  findGovernedActionExecutionAttempt,
  persistGovernedActionExecutionAttempt,
} from '@expadio/postgres-runtime/governed-action-execution';
import type {
  PersistedGovernedActionIntent,
} from '@expadio/postgres-runtime/governed-action-intent';
import { PostgresProviderRegistryRepository } from '@expadio/postgres-runtime/provider-registry';
import { PostgresCommunicationSuppressionRepository } from '@expadio/postgres-runtime/suppression';
import { PostgresCommunicationTemplateRepository } from '@expadio/postgres-runtime/template';

export interface GovernedCommunicateExecutionResult {
  readonly replayed: boolean;
  readonly attempt: PersistedGovernedActionExecutionAttempt;
  readonly queue: GovernedCommunicateQueueResult | null;
}

/**
 * Queue one persisted COMMUNICATE Action Intent through the existing
 * Communications fabric.
 *
 * Replay behavior is deliberately stronger than provider idempotency: once the
 * queue phase has an immutable execution attempt, redelivery returns that
 * attempt without re-running compliance, template, or routing work.
 */
async function executeGovernedCommunicateActionInTransaction(
  client: PoolClient,
  input: {
    readonly intent: PersistedGovernedActionIntent;
    readonly now?: () => string;
  },
): Promise<GovernedCommunicateExecutionResult> {
  const attemptKey = governedActionExecutionAttemptKey({
    actionIntentId: input.intent.actionIntentId,
    phase: 'communication.queue',
  });

  const existing = await findGovernedActionExecutionAttempt(client, {
    tenantId: input.intent.tenantId,
    actionIntentId: input.intent.actionIntentId,
    attemptKey,
  });
  if (existing !== null) {
    return {
      replayed: true,
      attempt: existing,
      queue: null,
    };
  }

  if (input.intent.executorClass !== 'COMMUNICATE') {
    const attemptedAtIso = input.now?.() ?? new Date().toISOString();
    const attemptedAt = new Date(attemptedAtIso);
    if (Number.isNaN(attemptedAt.getTime())) {
      throw new Error('GOVERNED_COMMUNICATE_EXECUTION_CLOCK_INVALID');
    }
    const attempt = await persistGovernedActionExecutionAttempt(client, {
      tenantId: input.intent.tenantId,
      actionIntentId: input.intent.actionIntentId,
      executorClass: 'COMMUNICATE',
      attemptKey,
      status: 'REFUSED',
      startedAt: attemptedAt,
      completedAt: attemptedAt,
      reasonCode: 'WRONG_EXECUTOR_CLASS',
      reason: 'This runtime only executes COMMUNICATE Action Intents.',
      outputReference: null,
      metadata: {
        sourceEventId: input.intent.sourceEventId,
        actionKey: input.intent.actionKey,
        suppliedExecutorClass: input.intent.executorClass,
      },
    });
    return {
      replayed: false,
      attempt,
      queue: {
        queued: false,
        reasonCode: 'WRONG_EXECUTOR_CLASS',
        reason: 'This runtime only executes COMMUNICATE Action Intents.',
      },
    };
  }

  const startedAtIso = input.now?.() ?? new Date().toISOString();
  const startedAt = new Date(startedAtIso);
  if (Number.isNaN(startedAt.getTime())) {
    throw new Error('GOVERNED_COMMUNICATE_EXECUTION_CLOCK_INVALID');
  }

  let queue: GovernedCommunicateQueueResult;
  let config: ReturnType<typeof parseGovernedCommunicateConfiguration>;
  try {
    config = parseGovernedCommunicateConfiguration(input.intent.configuration);
  } catch (error) {
    queue = {
      queued: false,
      reasonCode: 'CONFIGURATION_INVALID',
      reason: error instanceof Error ? error.message : 'Communication configuration is invalid.',
    };

    const attempt = await persistGovernedActionExecutionAttempt(client, {
      tenantId: input.intent.tenantId,
      actionIntentId: input.intent.actionIntentId,
      executorClass: 'COMMUNICATE',
      attemptKey,
      status: 'REFUSED',
      startedAt,
      completedAt: startedAt,
      reasonCode: queue.reasonCode,
      reason: queue.reason,
      outputReference: null,
      metadata: {
        sourceEventId: input.intent.sourceEventId,
        actionKey: input.intent.actionKey,
      },
    });

    return { replayed: false, attempt, queue };
  }

  const providers = new PostgresProviderRegistryRepository(client);
  const connectors = await providers.listConnectors(
    input.intent.tenantId,
    config.capabilityKey,
  );
  const routingPolicy = await providers.loadRoutingPolicy(
    input.intent.tenantId,
    config.capabilityKey,
  );

  queue = await queueGovernedCommunicateAction(input.intent, {
    compliance: {
      consent: new PostgresCommunicationConsentRepository(client),
      suppression: new PostgresCommunicationSuppressionRepository(client),
    },
    templates: new PostgresCommunicationTemplateRepository(client),
    delivery: new PostgresCommunicationDeliveryRepository(client),
    connectors,
    ...(routingPolicy === null ? {} : { routingPolicy }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });

  const completedAtIso = input.now?.() ?? new Date().toISOString();
  const completedAt = new Date(completedAtIso);
  if (Number.isNaN(completedAt.getTime())) {
    throw new Error('GOVERNED_COMMUNICATE_EXECUTION_CLOCK_INVALID');
  }

  const attempt = await persistGovernedActionExecutionAttempt(client, {
    tenantId: input.intent.tenantId,
    actionIntentId: input.intent.actionIntentId,
    executorClass: 'COMMUNICATE',
    attemptKey,
    status: queue.queued ? 'QUEUED' : 'REFUSED',
    startedAt,
    completedAt,
    reasonCode: queue.queued ? 'COMMUNICATION_QUEUED' : queue.reasonCode,
    reason: queue.queued ? null : queue.reason,
    outputReference: queue.queued
      ? `communication.delivery:${queue.delivery.deliveryId}`
      : null,
    metadata: queue.queued
      ? {
          sourceEventId: input.intent.sourceEventId,
          actionKey: input.intent.actionKey,
          channel: queue.preparedDispatch.channel,
          connectorKey: queue.connector.connectorKey,
          adapterKey: queue.delivery.adapterKey,
        }
      : {
          sourceEventId: input.intent.sourceEventId,
          actionKey: input.intent.actionKey,
        },
  });

  return {
    replayed: false,
    attempt,
    queue,
  };
}


/**
 * Public executor boundary. It owns the database transaction so the durable
 * communication delivery and immutable execution-attempt evidence are atomic.
 * Callers should not wrap this function in another PostgreSQL transaction.
 */
export async function executeGovernedCommunicateAction(
  client: PoolClient,
  input: {
    readonly intent: PersistedGovernedActionIntent;
    readonly now?: () => string;
  },
): Promise<GovernedCommunicateExecutionResult> {
  await client.query('BEGIN');
  try {
    const result = await executeGovernedCommunicateActionInTransaction(client, input);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
