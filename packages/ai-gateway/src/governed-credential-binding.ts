import type {
  ConnectorDefinition,
  CredentialLease,
  CredentialLeaseRequest,
  GovernedCredentialLeaseService,
} from '@expadio/provider-registry';
import type {
  ConnectorCredentialRepository,
  SecretResolver,
} from '@expadio/provider-registry/repository';
import type { AiApiTokenProvider } from './gemini-adapter.ts';
import { aiCapabilityKey } from './routing.ts';

export type AiCredentialLeaseService =
  Pick<GovernedCredentialLeaseService, 'issue'>;

export interface GovernedAiCredentialProviderOptions {
  readonly connectors: readonly ConnectorDefinition[];
  readonly credentialRepository: ConnectorCredentialRepository;
  readonly leaseService: AiCredentialLeaseService;
  readonly secretResolver: SecretResolver;
  readonly requestedBySubjectId: string;
  readonly requestId: () => string;
  readonly correlationId: () => string;
  readonly now?: () => string;
}

export type GovernedAiCredentialErrorCode =
  | 'AI_CONNECTOR_INVALID'
  | 'AI_CREDENTIAL_REFERENCE_UNAVAILABLE'
  | 'AI_SECRET_EXPIRED';

export class GovernedAiCredentialError extends Error {
  readonly code: GovernedAiCredentialErrorCode;

  constructor(code: GovernedAiCredentialErrorCode, message: string) {
    super(message);
    this.name = 'GovernedAiCredentialError';
    this.code = code;
  }
}

/**
 * Produces an adapter token callback that resolves plaintext only after the
 * routed connector's credential reference receives an authorized, audited,
 * short-lived lease. Plaintext is never returned to the Learning domain.
 */
export function governedAiApiTokenProvider(
  options: GovernedAiCredentialProviderOptions,
): AiApiTokenProvider {
  stable(options.requestedBySubjectId, 'requested subject id');
  const connectors = new Map(
    options.connectors.map((connector) => [connector.connectorKey, connector]),
  );

  return async (request): Promise<string> => {
    const connector = connectors.get(request.connectorKey);
    const capabilityKey = aiCapabilityKey(request.operation);
    if (
      connector === undefined
      || !connector.enabled
      || !connector.capabilityKeys.includes(capabilityKey)
      || (
        connector.ownership === 'TENANT'
        && connector.tenantId !== request.tenantId
      )
    ) {
      throw new GovernedAiCredentialError(
        'AI_CONNECTOR_INVALID',
        'AI connector is not enabled, capable, and scoped to this tenant.',
      );
    }

    const credentialReference =
      await options.credentialRepository.loadCredentialReference(
        request.tenantId,
        connector.connectorKey,
      );
    if (credentialReference === null) {
      throw new GovernedAiCredentialError(
        'AI_CREDENTIAL_REFERENCE_UNAVAILABLE',
        'AI connector has no managed credential reference.',
      );
    }

    const leaseRequest: CredentialLeaseRequest = {
      requestId: stable(options.requestId(), 'credential request id'),
      tenantId: request.tenantId,
      requestedBySubjectId: options.requestedBySubjectId,
      connectorKey: connector.connectorKey,
      purpose: `${capabilityKey}:${request.purpose}`,
      requestedAt: request.requestedAt,
      correlationId: stable(
        options.correlationId(),
        'credential correlation id',
      ),
      evidenceRefs: [
        `ai://idempotency/${encodeURIComponent(request.idempotencyKey)}`,
        `ai://operation/${encodeURIComponent(request.operation)}`,
      ],
    };

    const lease = await options.leaseService.issue(
      leaseRequest,
      { ...connector, credentialRef: credentialReference },
    );
    const resolvedAt = options.now?.() ?? new Date().toISOString();
    assertLeaseCurrent(lease, resolvedAt);

    const secret = await options.secretResolver.resolve(
      lease.credentialReference,
    );
    if (
      secret.expiresAt !== undefined
      && secret.expiresAt.getTime() <= Date.parse(resolvedAt)
    ) {
      throw new GovernedAiCredentialError(
        'AI_SECRET_EXPIRED',
        'Resolved AI credential is expired.',
      );
    }
    return secret.value;
  };
}

function assertLeaseCurrent(
  lease: CredentialLease,
  requestedAt: string,
): void {
  const at = Date.parse(requestedAt);
  const issuedAt = Date.parse(lease.issuedAt);
  const expiresAt = Date.parse(lease.expiresAt);
  if (
    !Number.isFinite(at)
    || !Number.isFinite(issuedAt)
    || !Number.isFinite(expiresAt)
    || issuedAt > at
    || expiresAt <= at
  ) {
    throw new GovernedAiCredentialError(
      'AI_SECRET_EXPIRED',
      'AI credential lease is not active for this invocation.',
    );
  }
}

function stable(value: string, label: string): string {
  if (
    value.trim().length === 0
    || value !== value.trim()
    || /[\r\n\t]/u.test(value)
  ) {
    throw new GovernedAiCredentialError(
      'AI_CONNECTOR_INVALID',
      `${label} is invalid.`,
    );
  }
  return value;
}

export type { SecretResolver } from '@expadio/provider-registry/repository';
