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
import type {
  LinkedInAccessTokenProvider,
  LinkedInSocialCredentialRequest,
} from './linkedin-social-text-adapter.ts';

const LINKEDIN_PROVIDER_KEY = 'linkedin';
const SOCIAL_CAPABILITY_KEY = 'communication.social.send';

export type CredentialLeaseService = Pick<GovernedCredentialLeaseService, 'issue'>;

export interface GovernedLinkedInCredentialProviderOptions {
  readonly connector: ConnectorDefinition;
  readonly credentialRepository: ConnectorCredentialRepository;
  readonly leaseService: CredentialLeaseService;
  readonly secretResolver: SecretResolver;
  readonly requestedBySubjectId: string;
  readonly requestId: () => string;
  readonly correlationId: () => string;
  readonly now?: () => string;
}

export type GovernedLinkedInCredentialErrorCode =
  | 'LINKEDIN_CONNECTOR_INVALID'
  | 'LINKEDIN_CREDENTIAL_REFERENCE_UNAVAILABLE'
  | 'LINKEDIN_SECRET_EXPIRED';

export class GovernedLinkedInCredentialError extends Error {
  readonly code: GovernedLinkedInCredentialErrorCode;

  constructor(code: GovernedLinkedInCredentialErrorCode, message: string) {
    super(message);
    this.name = 'GovernedLinkedInCredentialError';
    this.code = code;
  }
}

/**
 * Produces a send-time token callback for one routed LinkedIn connector.
 * Same lease shape as Resend: load reference → issue audited lease → resolve secret.
 * The raw secret is returned only to the adapter.
 *
 * Construction rejects a disabled connector so a dark `social.linkedin` seed
 * cannot mint tokens.
 */
export function governedLinkedInAccessTokenProvider(
  options: GovernedLinkedInCredentialProviderOptions,
): LinkedInAccessTokenProvider {
  validateConnector(options.connector);
  stable(options.requestedBySubjectId, 'requested subject id');

  return async (request: LinkedInSocialCredentialRequest): Promise<string> => {
    const credentialReference = await options.credentialRepository.loadCredentialReference(
      request.tenantId,
      options.connector.connectorKey,
    );
    if (credentialReference === null) {
      throw new GovernedLinkedInCredentialError(
        'LINKEDIN_CREDENTIAL_REFERENCE_UNAVAILABLE',
        'LinkedIn connector has no managed credential reference.',
      );
    }

    const leaseRequest: CredentialLeaseRequest = {
      requestId: stable(options.requestId(), 'credential request id'),
      tenantId: request.tenantId,
      requestedBySubjectId: options.requestedBySubjectId,
      connectorKey: options.connector.connectorKey,
      purpose: `${SOCIAL_CAPABILITY_KEY}:${request.purpose}`,
      requestedAt: request.requestedAt,
      correlationId: stable(options.correlationId(), 'credential correlation id'),
      evidenceRefs: [
        `communication://trigger/${encodeURIComponent(request.triggerKey)}`,
        `communication://idempotency/${encodeURIComponent(request.idempotencyKey)}`,
      ],
    };
    const connector = { ...options.connector, credentialRef: credentialReference };
    const lease = await options.leaseService.issue(leaseRequest, connector);
    const resolvedAt = options.now?.() ?? new Date().toISOString();
    assertLeaseIsCurrent(lease, resolvedAt);

    const secret = await options.secretResolver.resolve(lease.credentialReference);
    if (secret.expiresAt !== undefined && secret.expiresAt.getTime() <= Date.parse(resolvedAt)) {
      throw new GovernedLinkedInCredentialError(
        'LINKEDIN_SECRET_EXPIRED',
        'Resolved LinkedIn credential is expired.',
      );
    }
    return secret.value;
  };
}

function validateConnector(connector: ConnectorDefinition): void {
  const valid = connector.enabled
    && connector.providerKey.trim().toLowerCase() === LINKEDIN_PROVIDER_KEY
    && connector.capabilityKeys.includes(SOCIAL_CAPABILITY_KEY);
  if (!valid) {
    throw new GovernedLinkedInCredentialError(
      'LINKEDIN_CONNECTOR_INVALID',
      'Connector is not an enabled LinkedIn social connector.',
    );
  }
}

function assertLeaseIsCurrent(lease: CredentialLease, requestedAt: string): void {
  const at = Date.parse(requestedAt);
  const issuedAt = Date.parse(lease.issuedAt);
  const expiresAt = Date.parse(lease.expiresAt);
  if (!Number.isFinite(at) || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
    || issuedAt > at || expiresAt <= at) {
    throw new GovernedLinkedInCredentialError(
      'LINKEDIN_SECRET_EXPIRED',
      'LinkedIn credential lease is not active for this send attempt.',
    );
  }
}

function stable(value: string, label: string): string {
  if (value.trim().length === 0 || value !== value.trim() || /[\r\n\t]/u.test(value)) {
    throw new GovernedLinkedInCredentialError(
      'LINKEDIN_CONNECTOR_INVALID',
      `${label} is invalid.`,
    );
  }
  return value;
}

export type { SecretResolver } from '@expadio/provider-registry/repository';
