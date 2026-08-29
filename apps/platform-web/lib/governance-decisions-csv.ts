import type { GovernedDecision } from './governance-decisions';
import { toCsv } from './csv.ts';

/**
 * Render the governed-decision log as RFC 4180 CSV for compliance export — the
 * audit record auditors ask to take away. Pure and deterministic: the route
 * loads the decisions (RLS-scoped) and hands them here; keeping the formatting
 * out of the route makes the column mapping directly unit-testable.
 */

export const DECISIONS_CSV_HEADER = [
  'decided_at', 'work_type', 'subject_type', 'subject_id', 'stage',
  'outcome', 'decided_by', 'code', 'evidence_refs', 'instance_state',
] as const;

export function toDecisionsCsv(decisions: readonly GovernedDecision[]): string {
  return toCsv(
    DECISIONS_CSV_HEADER,
    decisions.map((d) => [
      d.decidedAt, d.workTypeKey, d.subjectType, d.subjectId, d.stageKey,
      d.outcome, d.decidedBySubjectId, d.code, d.evidenceRefs.join('; '), d.instanceState,
    ]),
  );
}
