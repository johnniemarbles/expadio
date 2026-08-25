import {
  authorizeAccess,
  requiredPlatformCapability,
  type AccessControlDecision,
  type DegradedCapabilityPolicy,
} from '@expadio/access-control';
import {
  buildAuthorizationInput,
  type AuthorizationPolicyRepository,
  type PersistedAuthorizationInput,
} from '@expadio/authorization-persistence';
import type { ResolvedCapabilityState } from '@expadio/capabilities';
import type { EffectiveContext } from '@expadio/tenancy';

export interface CapabilityAvailabilityRepository {
  loadCapabilityState(
    context: EffectiveContext,
    capabilityKey: string,
  ): Promise<ResolvedCapabilityState | null>;
}

export interface PersistedAccessInput extends PersistedAuthorizationInput {
  readonly requiredCapabilityKey?: string;
  readonly degradedPolicy?: DegradedCapabilityPolicy;
}

export interface AccessRuntimeDependencies {
  readonly authorizationPolicyRepository: AuthorizationPolicyRepository;
  readonly capabilityAvailabilityRepository: CapabilityAvailabilityRepository;
}

/**
 * Executes persisted actor authorization first. Capability state is loaded only
 * after actor authorization succeeds, preventing unauthorized callers from
 * probing tenant capability configuration through this runtime path.
 */
export async function authorizePersistedAccess(
  dependencies: AccessRuntimeDependencies,
  input: PersistedAccessInput,
): Promise<AccessControlDecision> {
  const authorization = await buildAuthorizationInput(
    dependencies.authorizationPolicyRepository,
    input,
  );

  const actorDecision = authorizeAccess({ authorization });
  if (!actorDecision.allowed || input.requiredCapabilityKey === undefined) {
    return actorDecision;
  }

  const resolved =
    (await dependencies.capabilityAvailabilityRepository.loadCapabilityState(
      input.context,
      input.requiredCapabilityKey,
    )) ?? missingCapabilityState();

  return authorizeAccess({
    authorization,
    requiredCapability: requiredPlatformCapability(
      input.requiredCapabilityKey,
      resolved,
      input.degradedPolicy ?? 'ALLOW',
    ),
  });
}

function missingCapabilityState(): ResolvedCapabilityState {
  return {
    state: 'NOT_CONFIGURED',
    reasonKey: 'CAPABILITY_BINDING_NOT_FOUND',
    blockingStepKey: 'CONFIGURE_CAPABILITY',
    blockingBoundKey: null,
    ifYouDoNothing: [
      'The operation remains unavailable until this capability is configured for the tenant or organization.',
    ],
  };
}
