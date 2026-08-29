import type { GovernedInstance } from './governance-instances';
import { toCsv } from './csv.ts';

/**
 * Render the in-flight workflow view as RFC 4180 CSV — the open governed work an
 * oversight lead takes away for a review. Pure and deterministic; the route
 * loads the instances (RLS-scoped, filtered) and hands them here.
 */

export const INSTANCES_CSV_HEADER = [
  'work_type', 'subject_type', 'subject_id', 'state', 'current_stage', 'revision', 'started_at', 'updated_at',
] as const;

export function toInstancesCsv(instances: readonly GovernedInstance[]): string {
  return toCsv(
    INSTANCES_CSV_HEADER,
    instances.map((i) => [
      i.workTypeKey, i.subjectType, i.subjectId, i.state,
      i.currentStageKey ?? '', i.revision, i.startedAt ?? '', i.updatedAt,
    ]),
  );
}
