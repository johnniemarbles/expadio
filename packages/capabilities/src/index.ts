export type CapabilityMode = 'A' | 'B' | 'C' | 'D';

export type CapabilityState =
  | 'ACTIVE'
  | 'PLATFORM_DEFAULT'
  | 'PENDING_PROOF'
  | 'DEGRADED'
  | 'VIOLATING'
  | 'SUSPENDED'
  | 'LOCKED_BY_PLAN'
  | 'NOT_CONFIGURED';

export type CapabilityProofStatus = 'MATCHED' | 'PENDING' | 'FAILED';

export interface CapabilityProof {
  readonly proofKey: string;
  readonly status: CapabilityProofStatus;
}

export interface CapabilityStateInput {
  readonly capabilityKey: string;
  readonly mode: CapabilityMode | null;
  readonly permittedModes: readonly CapabilityMode[];
  readonly proofs: readonly CapabilityProof[];
  readonly isEntitled: boolean;
  readonly isWithinBounds: boolean;
  readonly boundViolationKey?: string;
  readonly graceExpiresAt?: Date;
}

export interface ResolvedCapabilityState {
  readonly state: CapabilityState;
  readonly reasonKey: string | null;
  readonly blockingStepKey: string | null;
  readonly blockingBoundKey: string | null;
  readonly ifYouDoNothing: readonly string[];
}

export function resolveCapabilityState(
  input: CapabilityStateInput,
  now: Date = new Date(),
): ResolvedCapabilityState {
  if (!input.isEntitled) {
    return blocked(
      'LOCKED_BY_PLAN',
      'MISSING_ENTITLEMENT',
      'UPGRADE_PLAN',
      null,
      'Capability will remain disabled until the required entitlement is available.',
    );
  }

  if (!input.isWithinBounds) {
    if (
      input.graceExpiresAt !== undefined &&
      input.graceExpiresAt.getTime() < now.getTime()
    ) {
      return blocked(
        'SUSPENDED',
        'BOUND_VIOLATION_GRACE_EXPIRED',
        'UPDATE_SETTINGS',
        input.boundViolationKey ?? null,
        'Capability will remain suspended until configuration returns within allowed bounds.',
      );
    }

    return blocked(
      'VIOLATING',
      'BOUND_VIOLATION',
      'UPDATE_SETTINGS',
      input.boundViolationKey ?? null,
      'Capability will be suspended if the violation is not resolved before the grace period ends.',
    );
  }

  if (input.mode === null) {
    return blocked(
      'NOT_CONFIGURED',
      'MISSING_MODE',
      'SELECT_MODE',
      null,
      'Capability will not process requests until a mode is selected.',
    );
  }

  if (!input.permittedModes.includes(input.mode)) {
    return blocked(
      'NOT_CONFIGURED',
      'MODE_NOT_PERMITTED',
      'SELECT_MODE',
      null,
      `Mode ${input.mode} is not permitted for ${input.capabilityKey}.`,
    );
  }

  if (input.mode === 'A') {
    return ready('PLATFORM_DEFAULT');
  }

  if (input.proofs.length === 0) {
    return ready('ACTIVE');
  }

  const matched = input.proofs.filter((proof) => proof.status === 'MATCHED').length;
  const pending = input.proofs.filter((proof) => proof.status === 'PENDING').length;
  const failed = input.proofs.filter((proof) => proof.status === 'FAILED').length;

  if (matched === input.proofs.length) {
    return ready('ACTIVE');
  }

  if (matched > 0) {
    return blocked(
      'DEGRADED',
      'PARTIAL_PROOFS',
      'COMPLETE_PROOFS',
      null,
      'Capability is operating with partial provider or configuration proof coverage.',
    );
  }

  if (pending > 0) {
    return blocked(
      'PENDING_PROOF',
      'WAITING_FOR_PROOFS',
      'COMPLETE_PROOFS',
      null,
      'Capability setup remains incomplete while required proofs are pending.',
    );
  }

  if (failed > 0) {
    return blocked(
      'PENDING_PROOF',
      'PROOFS_FAILED',
      'COMPLETE_PROOFS',
      null,
      'Capability setup remains incomplete because required proofs failed.',
    );
  }

  return blocked(
    'PENDING_PROOF',
    'WAITING_FOR_PROOFS',
    'COMPLETE_PROOFS',
    null,
    'Capability setup remains incomplete.',
  );
}

export function isOperationalState(state: CapabilityState): boolean {
  return state === 'ACTIVE' || state === 'PLATFORM_DEFAULT' || state === 'DEGRADED';
}

function ready(state: 'ACTIVE' | 'PLATFORM_DEFAULT'): ResolvedCapabilityState {
  return {
    state,
    reasonKey: null,
    blockingStepKey: null,
    blockingBoundKey: null,
    ifYouDoNothing: [],
  };
}

function blocked(
  state: CapabilityState,
  reasonKey: string,
  blockingStepKey: string,
  blockingBoundKey: string | null,
  consequence: string,
): ResolvedCapabilityState {
  return {
    state,
    reasonKey,
    blockingStepKey,
    blockingBoundKey,
    ifYouDoNothing: [consequence],
  };
}

export * from './agent-capability-manifest.ts';
export * from './agent-capability-resolution.ts';
