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
  type SupabaseStorageCredentialRequest,
} from '@expadio/storage';
import { delegatedSecretResolver } from './vault-secret-resolver';

export interface GovernedArtifactStorageOptions {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly serviceSubjectId: string;
  readonly correlationId: string;
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

function supportedStorageConnector(connector: ConnectorDefinition): boolean {
  const provider =
    `${connector.providerType}:${connector.providerKey}`.toLowerCase();
  return connector.enabled
    && (
      provider.includes('supabase')
      || provider.includes('supabase-storage')
    )
    && connector.capabilityKeys.includes('storage.store')
    && connector.capabilityKeys.includes('storage.read');
}

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
  const correlationId = stable(
    options.correlationId,
    'GOVERNED_ARTIFACT_STORAGE_CORRELATION_INVALID',
  );

  const registry = new PostgresProviderRegistryRepository(client);
  const [
    storeConnectors,
    storePolicy,
    readConnectors,
    readPolicy,
  ] = await Promise.all([
    registry.listConnectors(tenantId, 'storage.store'),
    registry.loadRoutingPolicy(tenantId, 'storage.store'),
    registry.listConnectors(tenantId, 'storage.read'),
    registry.loadRoutingPolicy(tenantId, 'storage.read'),
  ]);

  const routeBase = {
    tenantId,
    requiredResidencyTags: options.requiredResidencyTags,
    requiredComplianceTags: options.requiredComplianceTags,
  };
  const storeRoute = routeConnector(
    { ...routeBase, capabilityKey: 'storage.store' },
    storeConnectors,
    storePolicy ?? undefined,
  );
  const readRoute = routeConnector(
    { ...routeBase, capabilityKey: 'storage.read' },
    readConnectors,
    readPolicy ?? undefined,
  );

  const connector = storeRoute.connector;
  if (connector === null) {
    throw new Error(
      `GOVERNED_ARTIFACT_STORAGE_CONNECTOR_UNAVAILABLE:STORE:${storeRoute.reason}`,
    );
  }
  if (readRoute.connector === null) {
    throw new Error(
      `GOVERNED_ARTIFACT_STORAGE_CONNECTOR_UNAVAILABLE:READ:${readRoute.reason}`,
    );
  }
  if (readRoute.connector.connectorKey !== connector.connectorKey) {
    throw new Error('GOVERNED_ARTIFACT_STORAGE_ROUTE_SPLIT_UNSUPPORTED');
  }
  if (!supportedStorageConnector(connector)) {
    throw new Error(
      'GOVERNED_ARTIFACT_STORAGE_CONNECTOR_CAPABILITIES_INCOMPLETE',
    );
  }

  const credentialRepository =
    new PostgresConnectorCredentialRepository(client);
  const credentialReference =
    await credentialRepository.loadCredentialReference(
      tenantId,
      connector.connectorKey,
    );
  if (credentialReference === null) {
    throw new Error(
      'GOVERNED_ARTIFACT_STORAGE_CREDENTIAL_REFERENCE_UNAVAILABLE',
    );
  }

  const clock = () => options.now?.() ?? new Date();
  const nowIso = () => clock().toISOString();
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

  const connectorWithCredential: ConnectorDefinition = {
    ...connector,
    credentialRef: credentialReference,
  };

  const accessToken = async (
    request: SupabaseStorageCredentialRequest,
  ): Promise<string> => {
    const requiredCapability =
      request.operation === 'STORE' ? 'storage.store' : 'storage.read';
    if (!connector.capabilityKeys.includes(requiredCapability)) {
      throw new Error(
        'GOVERNED_ARTIFACT_STORAGE_OPERATION_CAPABILITY_UNAVAILABLE',
      );
    }
    if (request.tenantId !== tenantId) {
      throw new Error('GOVERNED_ARTIFACT_STORAGE_TENANT_MISMATCH');
    }

    const lease = await leaseService.issue(
      {
        requestId: randomUUID(),
        tenantId,
        requestedBySubjectId: serviceSubjectId,
        connectorKey: connector.connectorKey,
        purpose:
          `storage.${request.operation.toLowerCase()}:${request.purpose}`,
        requestedAt: request.requestedAt,
        correlationId,
        evidenceRefs: [
          `storage://artifact/${encodeURIComponent(request.idempotencyKey)}`,
        ],
      },
      connectorWithCredential,
    );

    const resolvedAt = clock();
    if (
      !Number.isFinite(resolvedAt.getTime())
      || Date.parse(lease.issuedAt) > resolvedAt.getTime()
      || Date.parse(lease.expiresAt) <= resolvedAt.getTime()
    ) {
      throw new Error('GOVERNED_ARTIFACT_STORAGE_LEASE_INVALID');
    }

    const secret = await (
      options.secretResolver ?? delegatedSecretResolver
    ).resolve(lease.credentialReference);
    if (
      secret.expiresAt !== undefined
      && secret.expiresAt.getTime() <= resolvedAt.getTime()
    ) {
      throw new Error('GOVERNED_ARTIFACT_STORAGE_SECRET_EXPIRED');
    }
    return secret.value;
  };

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
