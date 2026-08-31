import type {
  ConnectorDefinition,
  CredentialLease,
  CredentialLeaseRequest,
  GovernedCredentialLeaseService,
} from './index.ts';
import type {
  ConnectorCredentialRepository,
  SecretResolver,
} from './repository.ts';

export interface GovernedApiCredentialRequest {
  readonly tenantId: string;
  readonly connectorKey: string;
  readonly operation: string;
  readonly purpose: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
}

export type GovernedApiTokenProvider =
  (request: GovernedApiCredentialRequest) => Promise<string>;

export interface GovernedApiTokenProviderOptions {
  readonly connector: ConnectorDefinition;
  readonly credentialRepository: ConnectorCredentialRepository;
  readonly leaseService: Pick<GovernedCredentialLeaseService, 'issue'>;
  readonly secretResolver: SecretResolver;
  readonly requestedBySubjectId: string;
  readonly requestId: () => string;
  readonly correlationId: () => string;
  readonly now?: () => string;
}

export function governedApiTokenProvider(
  options: GovernedApiTokenProviderOptions,
): GovernedApiTokenProvider {
  stable(options.connector.connectorKey, 'connector key');
  stable(options.requestedBySubjectId, 'requested subject id');

  return async (request) => {
    if (
      request.connectorKey !== options.connector.connectorKey
      || request.tenantId.trim() === ''
      || request.operation.trim() === ''
      || request.purpose.trim() === ''
      || request.idempotencyKey.trim() === ''
    ) {
      throw new Error('GOVERNED_API_CREDENTIAL_REQUEST_INVALID');
    }

    const credentialReference =
      await options.credentialRepository.loadCredentialReference(
        request.tenantId,
        request.connectorKey,
      );
    if (credentialReference === null) {
      throw new Error('GOVERNED_API_CREDENTIAL_REFERENCE_UNAVAILABLE');
    }

    const leaseRequest: CredentialLeaseRequest = {
      requestId: stable(options.requestId(), 'credential request id'),
      tenantId: request.tenantId,
      requestedBySubjectId: options.requestedBySubjectId,
      connectorKey: request.connectorKey,
      purpose: `${request.operation}:${request.purpose}`,
      requestedAt: request.requestedAt,
      correlationId: stable(options.correlationId(), 'credential correlation id'),
      evidenceRefs: [
        `provider-operation://${encodeURIComponent(request.operation)}`,
        `provider-idempotency://${encodeURIComponent(request.idempotencyKey)}`,
      ],
    };

    const lease = await options.leaseService.issue(
      leaseRequest,
      { ...options.connector, credentialRef: credentialReference },
    );
    const resolvedAt = options.now?.() ?? new Date().toISOString();
    assertLeaseIsCurrent(lease, resolvedAt);

    const secret = await options.secretResolver.resolve(
      lease.credentialReference,
    );
    if (
      secret.expiresAt !== undefined
      && secret.expiresAt.getTime() <= Date.parse(resolvedAt)
    ) {
      throw new Error('GOVERNED_API_SECRET_EXPIRED');
    }
    return secret.value;
  };
}

function assertLeaseIsCurrent(
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
    throw new Error('GOVERNED_API_CREDENTIAL_LEASE_INACTIVE');
  }
}

function stable(value: string, label: string): string {
  if (
    value.trim().length === 0
    || value !== value.trim()
    || /[\r\n\t]/u.test(value)
  ) {
    throw new Error(`GOVERNED_API_${label.toUpperCase().replaceAll(' ', '_')}_INVALID`);
  }
  return value;
}
