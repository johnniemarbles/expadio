import type { GovernedDecision } from './governance-decisions';

/**
 * Render the governed-decision log as RFC 4180 CSV for compliance export — the
 * audit record auditors ask to take away. Pure and deterministic: the route
 * loads the decisions (RLS-scoped) and hands them here; keeping the formatting
 * out of the route makes the escaping directly unit-testable.
 */

export const DECISIONS_CSV_HEADER = [
  'decided_at', 'work_type', 'subject_type', 'subject_id', 'stage',
  'outcome', 'decided_by', 'code', 'evidence_refs', 'instance_state',
] as const;

// RFC 4180: a field is quoted when it contains a comma, quote, CR or LF, and any
// embedded quote is doubled. Everything is stringified first so a stray non-string
// never throws.
function cell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toDecisionsCsv(decisions: readonly GovernedDecision[]): string {
  const rows = [DECISIONS_CSV_HEADER.join(',')];
  for (const d of decisions) {
    rows.push([
      d.decidedAt, d.workTypeKey, d.subjectType, d.subjectId, d.stageKey,
      d.outcome, d.decidedBySubjectId, d.code, d.evidenceRefs.join('; '), d.instanceState,
    ].map(cell).join(','));
  }
  // Trailing CRLF so the file ends on a record boundary.
  return rows.join('\r\n') + '\r\n';
}
