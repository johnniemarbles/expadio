export interface TreatmentOwnerResolutionInput {
  readonly explicitOwnerSubjectId?: string | null;
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
 * Precedence is intentionally deterministic:
 *   1. explicit authorized owner requested for the conversion,
 *   2. existing Lead owner,
 *   3. conversion actor as the final fallback.
 *
 * The conversion actor remains the audit/assignment actor even when another
 * subject owns the resulting Treatment.
 */
export function resolveTreatmentOwnerSubjectId(
  input: TreatmentOwnerResolutionInput,
): string {
  const explicitOwner = normalizedSubjectId(input.explicitOwnerSubjectId);
  if (explicitOwner !== null) return explicitOwner;

  const leadOwner = normalizedSubjectId(input.leadOwnerSubjectId);
  if (leadOwner !== null) return leadOwner;

  const conversionActor = normalizedSubjectId(input.conversionActorSubjectId);
  if (conversionActor === null) {
    throw new Error('TREATMENT_OWNER_RESOLUTION_ACTOR_REQUIRED');
  }
  return conversionActor;
}
