import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  GeminiAiAdapter,
  OpenAiAiAdapter,
  RoutedAiGateway,
  aiCapabilityKey,
  type AiGateway,
  type AiInputResolver,
} from '@expadio/ai-gateway';
import {
  executeGovernedAiAction,
  governedActionExecutionAttemptKey,
  parseGovernedAiActionConfiguration,
  type PersistedGovernedActionExecutionAttempt,
} from '@expadio/governed-actions';
import {
  governedApiTokenProvider,
} from '@expadio/provider-registry';
import type { SecretResolver } from '@expadio/provider-registry/repository';
import {
  findGovernedActionExecutionAttempt,
  persistGovernedActionExecutionAttempt,
} from '@expadio/postgres-runtime/governed-action-execution';
import {
  createGovernedCredentialLeaseRuntime,
} from '@expadio/postgres-runtime/governed-credential-lease-runtime';
import type {
  PersistedGovernedActionIntent,
} from '@expadio/postgres-runtime/governed-action-intent';
import {
  PostgresConnectorCredentialRepository,
  PostgresProviderRegistryRepository,
} from '@expadio/postgres-runtime/provider-registry';
import {
  PostgresIndexedDurableArtifactSink,
} from '@expadio/postgres-runtime/indexed-artifact-sink';
import type { DurableArtifactSink } from '@expadio/storage';
import { delegatedSecretResolver } from './vault-secret-resolver';

export interface GovernedAiExecutionRuntimeOptions {
  readonly serviceSubjectId: string;
  readonly organizationId: string;
  /** Concrete durable blob/object sink; PostgreSQL indexing is added here. */
  readonly artifactBlobSink: DurableArtifactSink;
  readonly inputResolver: AiInputResolver;
  readonly secretResolver?: SecretResolver;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

export interface GovernedAiExecutionResult {
  readonly replayed: boolean;
  readonly attempt: PersistedGovernedActionExecutionAttempt;
  readonly approved: boolean;
  readonly proposalOutputReference: string | null;
}

function stable(value: string, code: string): string {
  const normalized = value.trim();
  if (normalized === '' || normalized !== value || /[\r\n\t]/u.test(value)) {
    throw new Error(code);
  }
  return normalized;
}

function noOpAiGateway(): AiGateway {
  return {
    async invoke() {
      throw new Error('AI_GATEWAY_MUST_NOT_BE_INVOKED');
    },
  };
}

/**
 * Execute one already-persisted AI_ACTION through the horizontal AI Gateway.
 *
 * This function deliberately does not discover/claim Action Intents or expose
 * an HTTP route. Scheduling remains outside this boundary until the provider,
 * artifact, and review controls are fully proven.
 *
 * The supplied client must already be scoped to the intent tenant. Provider
 * secrets are resolved only after the existing governed credential lease path
 * authorizes the selected connector.
 */
export async function executePersistedGovernedAiAction(
  client: PoolClient,
  input: {
    readonly intent: PersistedGovernedActionIntent;
    readonly options: GovernedAiExecutionRuntimeOptions;
  },
): Promise<GovernedAiExecutionResult> {
  const serviceSubjectId = stable(
    input.options.serviceSubjectId,
    'GOVERNED_AI_SERVICE_SUBJECT_INVALID',
  );
  const organizationId = stable(
    input.options.organizationId,
    'GOVERNED_AI_ORGANIZATION_ID_INVALID',
  );

  const attemptKey = governedActionExecutionAttemptKey({
    actionIntentId: input.intent.actionIntentId,
    phase: 'INVOKE_AI',
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
      approved: existing.metadata.approved === true,
      proposalOutputReference: existing.outputReference,
    };
  }

  let config: ReturnType<typeof parseGovernedAiActionConfiguration> | null = null;
  try {
    if (input.intent.executorClass === 'AI_ACTION') {
      config = parseGovernedAiActionConfiguration(input.intent.configuration);
    }
  } catch {
    // Let the domain executor produce the canonical configuration refusal.
  }

  let aiGateway: AiGateway = noOpAiGateway();

  if (input.intent.executorClass === 'AI_ACTION' && config !== null) {
    const capabilityKey = aiCapabilityKey(config.operation);
    const registry = new PostgresProviderRegistryRepository(client);
    const [connectors, routingPolicy] = await Promise.all([
      registry.listConnectors(input.intent.tenantId, capabilityKey),
      registry.loadRoutingPolicy(input.intent.tenantId, capabilityKey),
    ]);

    const credentialNow = () =>
      (input.options.now?.() ?? new Date()).toISOString();
    const leaseService = createGovernedCredentialLeaseRuntime({
      client,
      contextProvider: {
        async resolve() {
          return {
            subjectId: serviceSubjectId,
            actorKind: 'service',
            tenantId: input.intent.tenantId,
            organizationId,
          };
        },
      },
      now: credentialNow,
    });
    const credentialRepository =
      new PostgresConnectorCredentialRepository(client);
    const secretResolver =
      input.options.secretResolver ?? delegatedSecretResolver;

    const artifactSink = new PostgresIndexedDurableArtifactSink(
      client,
      input.options.artifactBlobSink,
    );
    const adapters = new Map();
    for (const connector of connectors) {
      const token = governedApiTokenProvider({
        connector,
        credentialRepository,
        leaseService,
        secretResolver,
        requestedBySubjectId: serviceSubjectId,
        requestId: () => randomUUID(),
        correlationId: () => input.intent.correlationId || randomUUID(),
        now: credentialNow,
      });

      if (
        connector.providerKey.toLowerCase() === 'openai'
        || connector.providerType.toLowerCase() === 'openai'
      ) {
        adapters.set(
          connector.connectorKey,
          new OpenAiAiAdapter({
            apiToken: token,
            artifactSink,
            inputResolver: input.options.inputResolver,
            ...(input.options.fetchImpl === undefined
              ? {}
              : { fetchImpl: input.options.fetchImpl }),
            now: credentialNow,
          }),
        );
      } else if (
        connector.providerKey.toLowerCase() === 'google-ai'
        || connector.providerType.toLowerCase() === 'gemini'
      ) {
        adapters.set(
          connector.connectorKey,
          new GeminiAiAdapter({
            apiToken: token,
            artifactSink,
            inputResolver: input.options.inputResolver,
            ...(input.options.fetchImpl === undefined
              ? {}
              : { fetchImpl: input.options.fetchImpl }),
            now: credentialNow,
          }),
        );
      }
    }

    aiGateway = new RoutedAiGateway({
      connectors,
      adapters,
      ...(routingPolicy === null ? {} : { policies: [routingPolicy] }),
    });
  }

  const result = await executeGovernedAiAction({
    intent: input.intent,
    actionIntentId: input.intent.actionIntentId,
    aiGateway,
    ...(input.options.now === undefined ? {} : { now: input.options.now }),
  });

  const attempt = await persistGovernedActionExecutionAttempt(
    client,
    result.attempt,
  );

  return {
    replayed: false,
    attempt,
    approved: result.status === 'SUCCEEDED' ? result.approved : false,
    proposalOutputReference:
      result.status === 'SUCCEEDED' ? result.proposal.outputReference : null,
  };
}
