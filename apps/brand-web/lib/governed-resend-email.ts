import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  routeConnector,
  type ConnectorDefinition,
} from '@expadio/provider-registry';
import {
  PostgresConnectorCredentialRepository,
  PostgresProviderRegistryRepository,
} from '@expadio/postgres-runtime/provider-registry';
import { createGovernedCredentialLeaseRuntime } from '@expadio/postgres-runtime/governed-credential-lease-runtime';
import { delegatedSecretResolver } from './vault-secret-resolver';

export const EMAIL_SEND_CAPABILITY_KEY = 'communication.email.send';

export interface GovernedResendTokenOptions {
  readonly tenantId: string;
  readonly organizationId?: string | null;
  readonly subjectId: string;
  readonly domain: string;
  readonly requestedAt: string;
  readonly requestId?: () => string;
  readonly correlationId?: () => string;
}

export interface GovernedResendToken {
  readonly token: string;
  readonly connectorKey: string;
}

function isResendConnector(connector: ConnectorDefinition): boolean {
  return connector.enabled
    && connector.capabilityKeys.includes(EMAIL_SEND_CAPABILITY_KEY)
    && connector.providerKey.trim().toLowerCase() === 'resend';
}

/**
 * Resolve a Resend API token for the tenant's email send connector.
 * Returns null when no enabled Resend connector is routed.
 */
export async function resolveGovernedResendToken(
  client: PoolClient,
  options: GovernedResendTokenOptions,
): Promise<GovernedResendToken | null> {
  const registry = new PostgresProviderRegistryRepository(client);
  const connectors = await registry.listConnectors(options.tenantId, EMAIL_SEND_CAPABILITY_KEY);
  const policy = await registry.loadRoutingPolicy(options.tenantId, EMAIL_SEND_CAPABILITY_KEY);
  const route = routeConnector(
    { tenantId: options.tenantId, capabilityKey: EMAIL_SEND_CAPABILITY_KEY },
    connectors,
    policy ?? undefined,
  );
  if (route.connector === null || !isResendConnector(route.connector)) {
    return null;
  }
  const connector = route.connector;

  const credentialRepository = new PostgresConnectorCredentialRepository(client);
  const credentialReference = await credentialRepository.loadCredentialReference(
    options.tenantId,
    connector.connectorKey,
  );
  if (credentialReference === null) {
    throw new Error('RESEND_CREDENTIAL_REFERENCE_UNAVAILABLE');
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
      purpose: `sender domain verification: ${options.domain}`,
      requestedAt: options.requestedAt,
      correlationId: correlationId(),
      evidenceRefs: [`sender-domain://${encodeURIComponent(options.domain)}`],
    },
    connectorWithCredential,
  );
  const secret = await delegatedSecretResolver.resolve(lease.credentialReference);
  return { token: secret.value, connectorKey: connector.connectorKey };
}
