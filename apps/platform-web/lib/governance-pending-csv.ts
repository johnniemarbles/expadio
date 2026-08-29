import type { PendingReview } from './governance-pending-reviews';
import { toCsv } from './csv.ts';

/**
 * Render the team-wide pending-review load as RFC 4180 CSV — the "who owes what"
 * a governance lead takes into a standup or escalation. Pure and deterministic;
 * the route loads the pending items (RLS-scoped, filtered) and hands them here.
 */

export const PENDING_CSV_HEADER = [
  'work_type', 'subject', 'subject_id', 'stage', 'slot', 'assignee', 'waiting_since',
] as const;

export function toPendingReviewsCsv(items: readonly PendingReview[]): string {
  return toCsv(
    PENDING_CSV_HEADER,
    items.map((i) => [
      i.workTypeKey, i.subjectLabel ?? '', i.subjectId, i.currentStageKey,
      i.participantKey, i.assigneeSubjectId, i.waitingSince,
    ]),
  );
}
