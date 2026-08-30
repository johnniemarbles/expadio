export interface TreatmentOwnerResolutionInput {
  readonly leadOwnerSubjectId?: string | null;
  readonly conversionActorSubjectId: string;
}

function normalizedSubjectId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

/**
 * Resolve the authoritative Treatment owner independently from the actor who
 * performs Lead conversion.
 *
 * Current conversion policy is deliberately narrow and safe:
 *   1. preserve the existing Lead owner when present,
 *   2. otherwise fall back to the conversion actor.
 *
 * Explicit reassignment is intentionally not accepted here. A future caller
 * may only introduce that behavior behind the Relationship Fabric's
 * authorization and audit policy.
 */
export function resolveTreatmentOwnerSubjectId(
  input: TreatmentOwnerResolutionInput,
): string {
  const leadOwner = normalizedSubjectId(input.leadOwnerSubjectId);
  if (leadOwner !== null) return leadOwner;

  const conversionActor = normalizedSubjectId(input.conversionActorSubjectId);
  if (conversionActor === null) {
    throw new Error('TREATMENT_OWNER_RESOLUTION_ACTOR_REQUIRED');
  }
  return conversionActor;
}
