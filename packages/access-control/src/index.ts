import {
  authorize,
  type AuthorizationDecision,
  type AuthorizationInput,
  type AuthorizationStage,
} from '@expadio/authorization';
import {
  isOperationalState,
  type CapabilityState,
  type ResolvedCapabilityState,
} from '@expadio/capabilities';

export type AccessControlStage = AuthorizationStage | 'PLATFORM_CAPABILITY';
export type DegradedCapabilityPolicy = 'ALLOW' | 'DENY';

export interface RequiredPlatformCapability {
  readonly capabilityKey: string;
  readonly state: CapabilityState;
  readonly reasonKey?: string | null;
  readonly blockingStepKey?: string | null;
  readonly degradedPolicy?: DegradedCapabilityPolicy;
}

export interface AccessControlInput {
  readonly authorization: AuthorizationInput;
  readonly requiredCapability?: RequiredPlatformCapability;
}

export interface AccessControlDecision {
  readonly allowed: boolean;
  readonly stage?: AccessControlStage;
  readonly reasonKey: string;
  readonly reason: string;
  readonly viaRole?: string;
  readonly vetoedBy?: string;
  readonly capabilityKey?: string;
  readonly capabilityState?: CapabilityState;
  readonly degraded?: boolean;
  readonly blockingStepKey?: string | null;
}

/**
 * Composes actor authorization with runtime capability availability.
 * Authorization runs first so callers without access cannot use this function
 * to probe tenant capability configuration/state.
 */
export function authorizeAccess(input: AccessControlInput): AccessControlDecision {
  const actorDecision = authorize(input.authorization);
  if (!actorDecision.allowed) return fromAuthorizationDecision(actorDecision);

  const requirement = input.requiredCapability;
  if (requirement === undefined) return fromAuthorizationDecision(actorDecision);

  const degraded = requirement.state === 'DEGRADED';
  const operational = isOperationalState(requirement.state);
  const degradedAllowed = !degraded || (requirement.degradedPolicy ?? 'ALLOW') === 'ALLOW';

  if (!operational || !degradedAllowed) {
    return {
      allowed: false,
      stage: 'PLATFORM_CAPABILITY',
      reasonKey:
        requirement.reasonKey ??
        (degraded && !degradedAllowed
          ? 'CAPABILITY_DEGRADED_NOT_ALLOWED'
          : `CAPABILITY_${requirement.state}`),
      reason: capabilityDenialReason(requirement.capabilityKey, requirement.state, degradedAllowed),
      capabilityKey: requirement.capabilityKey,
      capabilityState: requirement.state,
      degraded,
      ...(requirement.blockingStepKey !== undefined
        ? { blockingStepKey: requirement.blockingStepKey }
        : {}),
    };
  }

  return {
    ...fromAuthorizationDecision(actorDecision),
    capabilityKey: requirement.capabilityKey,
    capabilityState: requirement.state,
    degraded,
  };
}

export function requiredPlatformCapability(
  capabilityKey: string,
  state: ResolvedCapabilityState,
  degradedPolicy: DegradedCapabilityPolicy = 'ALLOW',
): RequiredPlatformCapability {
  return {
    capabilityKey,
    state: state.state,
    reasonKey: state.reasonKey,
    blockingStepKey: state.blockingStepKey,
    degradedPolicy,
  };
}

function fromAuthorizationDecision(decision: AuthorizationDecision): AccessControlDecision {
  return {
    allowed: decision.allowed,
    reasonKey: decision.reasonKey,
    reason: decision.reason,
    ...(decision.stage !== undefined ? { stage: decision.stage } : {}),
    ...(decision.viaRole !== undefined ? { viaRole: decision.viaRole } : {}),
    ...(decision.vetoedBy !== undefined ? { vetoedBy: decision.vetoedBy } : {}),
  };
}

function capabilityDenialReason(
  capabilityKey: string,
  state: CapabilityState,
  degradedAllowed: boolean,
): string {
  if (state === 'DEGRADED' && !degradedAllowed) {
    return `${capabilityKey} is degraded and this action requires full capability readiness.`;
  }
  return `${capabilityKey} is not operational for this action while its state is ${state}.`;
}
