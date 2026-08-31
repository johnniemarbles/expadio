import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  DeepgramSttAdapter,
  ElevenLabsTtsAdapter,
  RoutedVoiceGateway,
  voiceCapabilityKey,
  type VoiceInputResolver,
  type VoiceProviderAdapter,
  type VoiceIntelligenceIntent,
  type VoiceIntelligenceObservation,
} from '@expadio/voice-gateway';
import { governedApiTokenProvider } from '@expadio/provider-registry';
import type { SecretResolver } from '@expadio/provider-registry/repository';
import {
  createGovernedCredentialLeaseRuntime,
} from '@expadio/postgres-runtime/governed-credential-lease-runtime';
import {
  PostgresIndexedDurableArtifactSink,
} from '@expadio/postgres-runtime/indexed-artifact-sink';
import {
  PostgresConnectorCredentialRepository,
  PostgresProviderRegistryRepository,
} from '@expadio/postgres-runtime/provider-registry';
import type { DurableArtifactSink } from '@expadio/storage';
import { delegatedSecretResolver } from './vault-secret-resolver';

export interface GovernedVoiceRuntimeOptions {
  readonly serviceSubjectId: string;
  readonly organizationId: string;
  /** Concrete durable blob/object sink; PostgreSQL indexing is added here. */
  readonly artifactBlobSink: DurableArtifactSink;
  readonly inputResolver: VoiceInputResolver;
  readonly secretResolver?: SecretResolver;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

function stable(value: string, code: string): string {
  const normalized = value.trim();
  if (
    normalized === ''
    || normalized !== value
    || /[\r\n\t]/u.test(value)
  ) {
    throw new Error(code);
  }
  return normalized;
}

/**
 * Execute one governed Voice intelligence request through tenant-aware routing.
 *
 * This is provider composition only. It does not claim telephone transport,
 * conversational agent orchestration, or automatic Action Fabric mutation.
 */
export async function invokeGovernedVoiceIntelligence(
  client: PoolClient,
  input: {
    readonly intent: VoiceIntelligenceIntent;
    readonly options: GovernedVoiceRuntimeOptions;
  },
): Promise<VoiceIntelligenceObservation> {
  const serviceSubjectId = stable(
    input.options.serviceSubjectId,
    'GOVERNED_VOICE_SERVICE_SUBJECT_INVALID',
  );
  const organizationId = stable(
    input.options.organizationId,
    'GOVERNED_VOICE_ORGANIZATION_ID_INVALID',
  );

  const capabilityKey = voiceCapabilityKey(input.intent.operation);
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

  const adapters = new Map<string, VoiceProviderAdapter>();
  for (const connector of connectors) {
    const token = governedApiTokenProvider({
      connector,
      credentialRepository,
      leaseService,
      secretResolver,
      requestedBySubjectId: serviceSubjectId,
      requestId: () => randomUUID(),
      correlationId: () => input.intent.idempotencyKey,
      now: credentialNow,
    });

    if (
      connector.providerKey.toLowerCase() === 'deepgram'
      || connector.providerType.toLowerCase() === 'deepgram'
    ) {
      adapters.set(
        connector.connectorKey,
        new DeepgramSttAdapter({
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
      connector.providerKey.toLowerCase() === 'elevenlabs'
      || connector.providerType.toLowerCase() === 'elevenlabs'
    ) {
      adapters.set(
        connector.connectorKey,
        new ElevenLabsTtsAdapter({
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

  return new RoutedVoiceGateway({
    connectors,
    adapters,
    ...(routingPolicy === null ? {} : { policies: [routingPolicy] }),
  }).invoke(input.intent);
}
