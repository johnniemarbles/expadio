import {
  AuditedCredentialLeaseIssuer,
  GovernedCredentialLeaseService,
  PersistedCredentialLeaseAuthorizer,
  SEND_CREDENTIAL_LEASE_TTL_SECONDS,
  ShortLivedCredentialLeaseIssuer,
  type CredentialLeaseEffectiveContextProvider,
} from '@expadio/provider-registry';
import { PostgresAuthorizationPolicyRepository } from './authorization.ts';
import { PostgresCredentialLeaseAuditRepository } from './credential-lease-event.ts';
import type { PostgresClient } from './index.ts';

export interface GovernedCredentialLeaseRuntimeOptions {
  readonly client: PostgresClient;
  readonly contextProvider: CredentialLeaseEffectiveContextProvider;
  readonly now?: () => string;
  readonly decisionId?: () => string;
  readonly leaseId?: () => string;
  readonly issuerAuditId?: () => string;
  readonly auditEventId?: () => string;
}

/**
 * Composes the governed credential lease runtime for an already-bound request
 * transaction. The supplied Postgres client must already carry the verified
 * tenant/organization RLS context for the request.
 */
export function createGovernedCredentialLeaseRuntime(
  options: GovernedCredentialLeaseRuntimeOptions,
): GovernedCredentialLeaseService {
  const now = options.now ?? (() => new Date().toISOString());
  const authorizer = new PersistedCredentialLeaseAuthorizer({
    contextProvider: options.contextProvider,
    policyRepository: new PostgresAuthorizationPolicyRepository(options.client),
    decisionId: options.decisionId ?? (() => crypto.randomUUID()),
  });
  const issuer = new AuditedCredentialLeaseIssuer(
    new ShortLivedCredentialLeaseIssuer({
      ttlSeconds: SEND_CREDENTIAL_LEASE_TTL_SECONDS,
      now,
      leaseId: options.leaseId ?? (() => crypto.randomUUID()),
      auditId: options.issuerAuditId ?? (() => crypto.randomUUID()),
    }),
    new PostgresCredentialLeaseAuditRepository(options.client),
    options.auditEventId ?? (() => crypto.randomUUID()),
    now,
  );

  return new GovernedCredentialLeaseService(
    authorizer,
    issuer,
    SEND_CREDENTIAL_LEASE_TTL_SECONDS,
  );
}
