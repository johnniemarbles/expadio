import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  routeConnector,
  type ConnectorDefinition,
  type CredentialLease,
} from '@expadio/provider-registry';
import type { SecretResolver } from '@expadio/provider-registry/repository';
import {
  PostgresConnectorCredentialRepository,
  PostgresProviderRegistryRepository,
} from '@expadio/postgres-runtime/provider-registry';
import {
  createGovernedCredentialLeaseRuntime,
} from '@expadio/postgres-runtime/governed-credential-lease-runtime';
import { delegatedSecretResolver } from './vault-secret-resolver';

export const CLOUDFLARE_DNS_CAPABILITY_KEY = 'infrastructure.dns.configure';

export interface GovernedCloudflareDnsTokenOptions {
  readonly tenantId: string;
  readonly organizationId?: string | null;
  readonly subjectId: string;
  readonly domain: string;
  readonly purpose: string;
  readonly requestedAt: string;
  readonly secretResolver?: SecretResolver;
  readonly requestId?: () => string;
  readonly correlationId?: () => string;
  readonly now?: () => string;
}

export interface GovernedCloudflareDnsToken {
  readonly token: string;
  readonly connectorKey: string;
  readonly credentialReference: string;
}

function supportedCloudflareDnsConnector(connector: ConnectorDefinition): boolean {
  return connector.enabled
    && connector.capabilityKeys.includes(CLOUDFLARE_DNS_CAPABILITY_KEY)
    && connector.providerKey.trim().toLowerCase() === 'cloudflare'
    && ['dns', 'infrastructure', 'cloudflare-dns'].includes(connector.providerType.trim().toLowerCase());
}

function assertLeaseIsCurrent(lease: CredentialLease, requestedAt: string): void {
  const at = Date.parse(requestedAt);
  const issuedAt = Date.parse(lease.issuedAt);
  const expiresAt = Date.parse(lease.expiresAt);
  if (!Number.isFinite(at) || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
    || issuedAt > at || expiresAt <= at) {
    throw new Error('CLOUDFLARE_DNS_CREDENTIAL_LEASE_INVALID');
  }
}

/**
 * Resolve a Cloudflare DNS API token through the governed provider-registry +
 * credential-lease boundary. A missing routed connector intentionally returns
 * null so the domain endpoint can fall back to manual DNS instructions. A
 * present connector must have a credential reference that resolves through the
 * delegated secret resolver; plaintext never comes from request input or route
 * environment variables.
 */
export async function resolveGovernedCloudflareDnsToken(
  client: PoolClient,
  options: GovernedCloudflareDnsTokenOptions,
): Promise<GovernedCloudflareDnsToken | null> {
  const registry = new PostgresProviderRegistryRepository(client);
  const connectors = await registry.listConnectors(options.tenantId, CLOUDFLARE_DNS_CAPABILITY_KEY);
  const policy = await registry.loadRoutingPolicy(options.tenantId, CLOUDFLARE_DNS_CAPABILITY_KEY);
  const route = routeConnector(
    {
      tenantId: options.tenantId,
      capabilityKey: CLOUDFLARE_DNS_CAPABILITY_KEY,
    },
    connectors,
    policy ?? undefined,
  );
  if (route.connector === null) {
    return null;
  }
  const connector = route.connector;
  if (!supportedCloudflareDnsConnector(connector)) {
    throw new Error('CLOUDFLARE_DNS_CONNECTOR_UNSUPPORTED');
  }

  const credentialRepository = new PostgresConnectorCredentialRepository(client);
  const credentialReference = await credentialRepository.loadCredentialReference(
    options.tenantId,
    connector.connectorKey,
  );
  if (credentialReference === null) {
    throw new Error('CLOUDFLARE_DNS_CREDENTIAL_REFERENCE_UNAVAILABLE');
  }

  const connectorWithCredential: ConnectorDefinition = {
    ...connector,
    credentialRef: credentialReference,
  };
  const leaseService = createGovernedCredentialLeaseRuntime({
    client,
    contextProvider: {
      async resolve() {
        return {
          subjectId: options.subjectId,
          actorKind: 'user' as const,
          tenantId: options.tenantId,
          organizationId: options.organizationId ?? '',
        };
      },
    },
  });
  const requestId = options.requestId ?? randomUUID;
  const correlationId = options.correlationId ?? randomUUID;
  const lease = await leaseService.issue(
    {
      requestId: requestId(),
      tenantId: options.tenantId,
      requestedBySubjectId: options.subjectId,
      connectorKey: connector.connectorKey,
      purpose: options.purpose,
      requestedAt: options.requestedAt,
      correlationId: correlationId(),
      evidenceRefs: [`dns://${encodeURIComponent(options.domain)}`],
    },
    connectorWithCredential,
  );
  const resolvedAt = options.now?.() ?? new Date().toISOString();
  assertLeaseIsCurrent(lease, resolvedAt);

  const secret = await (options.secretResolver ?? delegatedSecretResolver).resolve(lease.credentialReference);
  if (secret.expiresAt !== undefined && secret.expiresAt.getTime() <= Date.parse(resolvedAt)) {
    throw new Error('CLOUDFLARE_DNS_SECRET_EXPIRED');
  }
  return {
    token: secret.value,
    connectorKey: connector.connectorKey,
    credentialReference: lease.credentialReference,
  };
}
