import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  routeConnector,
  type ConnectorDefinition,
} from '@expadio/provider-registry';
import type { SecretResolver } from '@expadio/provider-registry/repository';
import {
  PostgresConnectorCredentialRepository,
  PostgresProviderRegistryRepository,
} from '@expadio/postgres-runtime/provider-registry';
import {
  createGovernedCredentialLeaseRuntime,
} from '@expadio/postgres-runtime/governed-credential-lease-runtime';
import {
  SupabaseDurableArtifactStore,
  governedSupabaseStorageAccessTokenProvider,
} from '@expadio/storage';
import { delegatedSecretResolver } from './vault-secret-resolver';

export interface GovernedArtifactStorageOptions {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly serviceSubjectId: string;
  readonly projectUrl: string;
  readonly bucket: string;
  readonly requiredResidencyTags: readonly string[];
  readonly requiredComplianceTags: readonly string[];
  readonly signedUrlTtlSeconds?: number;
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

function supportsRequiredStorageCapabilities(
  connector: ConnectorDefinition,
): boolean {
  return connector.capabilityKeys.includes('storage.store')
    && connector.capabilityKeys.includes('storage.read');
}

/**
 * Composes one governed Supabase artifact backend for a tenant-bound request
 * transaction.
 *
 * The connector is selected through the platform provider registry and routing
 * policy. Credentials remain external references and are resolved only after
 * the existing authorization + short-lived credential lease path succeeds.
 *
 * The returned store implements both DurableArtifactSink and
 * DurableArtifactSource, so the same governed backend can be supplied to AI and
 * Voice production runtimes.
 */
export async function createGovernedSupabaseArtifactStore(
  client: PoolClient,
  options: GovernedArtifactStorageOptions,
): Promise<SupabaseDurableArtifactStore> {
  const tenantId = stable(
    options.tenantId,
    'GOVERNED_ARTIFACT_STORAGE_TENANT_INVALID',
  );
  const organizationId = stable(
    options.organizationId,
    'GOVERNED_ARTIFACT_STORAGE_ORGANIZATION_INVALID',
  );
  const serviceSubjectId = stable(
    options.serviceSubjectId,
    'GOVERNED_ARTIFACT_STORAGE_SUBJECT_INVALID',
  );

  const registry = new PostgresProviderRegistryRepository(client);
  const [connectors, routingPolicy] = await Promise.all([
    registry.listConnectors(tenantId, 'storage.store'),
    registry.loadRoutingPolicy(tenantId, 'storage.store'),
  ]);

  const route = routeConnector(
    {
      tenantId,
      capabilityKey: 'storage.store',
      requiredResidencyTags: options.requiredResidencyTags,
      requiredComplianceTags: options.requiredComplianceTags,
    },
    connectors,
    routingPolicy ?? undefined,
  );
  const connector = route.connector;
  if (connector === null) {
    throw new Error(
      `GOVERNED_ARTIFACT_STORAGE_CONNECTOR_UNAVAILABLE:${route.reason}`,
    );
  }
  if (!supportsRequiredStorageCapabilities(connector)) {
    throw new Error(
      'GOVERNED_ARTIFACT_STORAGE_CONNECTOR_CAPABILITIES_INCOMPLETE',
    );
  }

  const nowIso = () => (options.now?.() ?? new Date()).toISOString();
  const leaseService = createGovernedCredentialLeaseRuntime({
    client,
    contextProvider: {
      async resolve() {
        return {
          subjectId: serviceSubjectId,
          actorKind: 'service',
          tenantId,
          organizationId,
        };
      },
    },
    now: nowIso,
  });

  const accessToken = governedSupabaseStorageAccessTokenProvider({
    connector,
    credentialRepository: new PostgresConnectorCredentialRepository(client),
    leaseService,
    secretResolver: options.secretResolver ?? delegatedSecretResolver,
    requestedBySubjectId: serviceSubjectId,
    requestId: () => randomUUID(),
    correlationId: () => randomUUID(),
    now: nowIso,
  });

  return new SupabaseDurableArtifactStore({
    projectUrl: options.projectUrl,
    bucket: options.bucket,
    accessToken,
    residencyTags: connector.residencyTags,
    complianceTags: connector.complianceTags,
    ...(options.signedUrlTtlSeconds === undefined
      ? {}
      : { signedUrlTtlSeconds: options.signedUrlTtlSeconds }),
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}
