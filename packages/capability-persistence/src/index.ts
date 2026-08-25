import { createHash } from 'node:crypto';
import {
  resolveCapabilityState,
  type CapabilityMode,
  type CapabilityProof,
  type CapabilityState,
  type CapabilityStateInput,
  type ResolvedCapabilityState,
} from '@expadio/capabilities';

export interface CapabilityBindingRecord {
  readonly bindingId: string;
  readonly tenantId: string;
  readonly organizationId?: string;
  readonly capabilityKey: string;
  readonly connectorKey?: string;
  readonly mode: CapabilityMode | null;
  readonly permittedModes: readonly CapabilityMode[];
  readonly proofs: readonly CapabilityProof[];
  readonly isEntitled: boolean;
  readonly isWithinBounds: boolean;
  readonly boundViolationKey?: string;
  readonly graceExpiresAt?: Date;
}

export interface CapabilityStateSnapshot {
  readonly bindingId: string;
  readonly tenantId: string;
  readonly state: CapabilityState;
  readonly reasonKey: string | null;
  readonly blockingStepKey: string | null;
  readonly blockingBoundKey: string | null;
  readonly ifYouDoNothing: readonly string[];
  readonly inputHash: string;
  readonly version: number;
  readonly resolvedAt: Date;
}

export interface CapabilityStateEvent {
  readonly bindingId: string;
  readonly tenantId: string;
  readonly fromState: CapabilityState | null;
  readonly toState: CapabilityState;
  readonly reasonKey: string | null;
  readonly inputHash: string;
  readonly occurredAt: Date;
}

export interface CapabilityStateCommit {
  readonly expectedVersion: number | null;
  readonly snapshot: CapabilityStateSnapshot;
  readonly event: CapabilityStateEvent | null;
}

/**
 * Persistence adapter contract. `commit` must atomically compare the expected
 * version, replace the current snapshot and append the event when present.
 */
export interface CapabilityStateRepository {
  load(tenantId: string, bindingId: string): Promise<CapabilityStateSnapshot | null>;
  commit(change: CapabilityStateCommit): Promise<void>;
}

export interface PersistCapabilityStateResult {
  readonly snapshot: CapabilityStateSnapshot;
  readonly changed: boolean;
  readonly transitioned: boolean;
}

export async function resolveAndPersistCapabilityState(
  repository: CapabilityStateRepository,
  binding: CapabilityBindingRecord,
  now: Date = new Date(),
): Promise<PersistCapabilityStateResult> {
  const input = toStateInput(binding);
  const resolved = resolveCapabilityState(input, now);
  const inputHash = hashCapabilityStateInput(input);
  const current = await repository.load(binding.tenantId, binding.bindingId);

  if (current?.inputHash === inputHash) {
    return { snapshot: current, changed: false, transitioned: false };
  }

  const version = (current?.version ?? 0) + 1;
  const snapshot: CapabilityStateSnapshot = {
    bindingId: binding.bindingId,
    tenantId: binding.tenantId,
    state: resolved.state,
    reasonKey: resolved.reasonKey,
    blockingStepKey: resolved.blockingStepKey,
    blockingBoundKey: resolved.blockingBoundKey,
    ifYouDoNothing: resolved.ifYouDoNothing,
    inputHash,
    version,
    resolvedAt: now,
  };

  const transitioned = stateChanged(current, resolved);
  const event: CapabilityStateEvent | null = transitioned
    ? {
        bindingId: binding.bindingId,
        tenantId: binding.tenantId,
        fromState: current?.state ?? null,
        toState: resolved.state,
        reasonKey: resolved.reasonKey,
        inputHash,
        occurredAt: now,
      }
    : null;

  await repository.commit({
    expectedVersion: current?.version ?? null,
    snapshot,
    event,
  });

  return { snapshot, changed: true, transitioned };
}

export function hashCapabilityStateInput(input: CapabilityStateInput): string {
  const normalized = {
    capabilityKey: input.capabilityKey,
    mode: input.mode,
    permittedModes: [...input.permittedModes].sort(),
    proofs: [...input.proofs]
      .map((proof) => ({ proofKey: proof.proofKey, status: proof.status }))
      .sort((a, b) => a.proofKey.localeCompare(b.proofKey) || a.status.localeCompare(b.status)),
    isEntitled: input.isEntitled,
    isWithinBounds: input.isWithinBounds,
    boundViolationKey: input.boundViolationKey ?? null,
    graceExpiresAt: input.graceExpiresAt?.toISOString() ?? null,
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function toStateInput(binding: CapabilityBindingRecord): CapabilityStateInput {
  return {
    capabilityKey: binding.capabilityKey,
    mode: binding.mode,
    permittedModes: binding.permittedModes,
    proofs: binding.proofs,
    isEntitled: binding.isEntitled,
    isWithinBounds: binding.isWithinBounds,
    ...(binding.boundViolationKey !== undefined ? { boundViolationKey: binding.boundViolationKey } : {}),
    ...(binding.graceExpiresAt !== undefined ? { graceExpiresAt: binding.graceExpiresAt } : {}),
  };
}

function stateChanged(
  current: CapabilityStateSnapshot | null,
  resolved: ResolvedCapabilityState,
): boolean {
  if (current === null) return true;
  return (
    current.state !== resolved.state ||
    current.reasonKey !== resolved.reasonKey ||
    current.blockingStepKey !== resolved.blockingStepKey ||
    current.blockingBoundKey !== resolved.blockingBoundKey
  );
}
