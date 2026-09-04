/**
 * Escalation timing mechanics for the LeadManagementConfiguration lifecycle.
 *
 * ADR-017 Invariant 2: governed configuration changes that require explicit
 * parent approval never become effective through timeout alone. SLA expiry
 * escalates the decision to the next authorized ancestor — it does not lower
 * the approval standard or substitute for explicit authorization.
 *
 * This module is pure: no database, no network. All functions take ISO-8601
 * strings and return deterministic results.
 */

// ── SLA arithmetic ────────────────────────────────────────────────────────────

/**
 * Count business days (Mon–Fri) elapsed between two points in time.
 * The start date itself is not counted; each calendar day after the start that
 * falls Mon–Fri increments the counter. Returns 0 when `to` ≤ `from`.
 */
export function businessDaysElapsed(from: Date, to: Date): number {
  if (to <= from) return 0;
  let count = 0;
  const cursor = new Date(from.getTime());
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= to) {
    const dow = cursor.getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (dow !== 0 && dow !== 6) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/**
 * Return the date that is exactly `n` business days after `startDate`.
 * The result is the first date on which the SLA would be considered elapsed.
 */
export function addBusinessDays(startDate: Date, n: number): Date {
  const result = new Date(startDate.getTime());
  let remaining = n;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const dow = result.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return result;
}

/** ISO-8601 string of the moment the review SLA expires for a configuration
 *  submitted at `submittedAt` with the given SLA length. */
export function computeExpiryAt(submittedAt: string, slaBusinessDays: number): string {
  const start = new Date(submittedAt);
  if (!Number.isFinite(start.getTime())) throw new Error('INVALID_SUBMITTED_AT');
  if (!Number.isInteger(slaBusinessDays) || slaBusinessDays < 1) {
    throw new Error('INVALID_SLA_BUSINESS_DAYS');
  }
  return addBusinessDays(start, slaBusinessDays).toISOString();
}

// ── Deadline classification ───────────────────────────────────────────────────

export type ReviewDeadlineStatus =
  | 'ON_TIME'   // within the SLA; no escalation action needed yet
  | 'OVERDUE';  // SLA has elapsed; the ESCALATED transition should fire

/** Classify whether a review period has elapsed as of `now`. */
export function classifyReviewDeadline(
  submittedAt: string,
  slaBusinessDays: number,
  now: string,
): ReviewDeadlineStatus {
  const start = new Date(submittedAt);
  const current = new Date(now);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(current.getTime())) {
    throw new Error('INVALID_DATE');
  }
  const elapsed = businessDaysElapsed(start, current);
  return elapsed >= slaBusinessDays ? 'OVERDUE' : 'ON_TIME';
}

// ── Escalation entry ──────────────────────────────────────────────────────────

/** Records a single step in the escalation chain — either a timeout-driven
 *  escalation or the terminal expiry when the chain is exhausted. */
export interface EscalationEntry {
  readonly escalationId: string;
  readonly configId: string;
  readonly fromOrganizationId: string;
  /** The ancestor organization this was escalated to, or null when the
   *  escalation chain is exhausted (no authorized ancestor remains). */
  readonly toOrganizationId: string | null;
  readonly escalatedAt: string;
  readonly expiresAt: string;
  readonly resolvedAt: string | null;
  readonly outcome: 'PENDING' | 'APPROVED' | 'EXPIRED_NO_ACTION';
}

export interface BuildEscalationEntryOptions {
  readonly escalationId: string;
  readonly configId: string;
  readonly fromOrganizationId: string;
  readonly toOrganizationId: string | null;
  readonly escalatedAt: string;
  /** SLA for escalated review. ADR-017 default: 3 business days. */
  readonly escalationSlaBusinessDays?: number;
}

export function buildEscalationEntry(options: BuildEscalationEntryOptions): EscalationEntry {
  const sla = options.escalationSlaBusinessDays ?? 3;
  return {
    escalationId: options.escalationId,
    configId: options.configId,
    fromOrganizationId: options.fromOrganizationId,
    toOrganizationId: options.toOrganizationId,
    escalatedAt: options.escalatedAt,
    expiresAt: computeExpiryAt(options.escalatedAt, sla),
    resolvedAt: null,
    outcome: 'PENDING',
  };
}

// ── Escalation chain analysis ─────────────────────────────────────────────────

export type EscalationChainStatus =
  | 'AWAITING_INITIAL_REVIEW'  // still in the primary review window
  | 'ESCALATED_PENDING'        // escalated; awaiting ancestor decision
  | 'ESCALATED_OVERDUE'        // escalation SLA also elapsed; chain should advance or expire
  | 'CHAIN_EXHAUSTED';         // no authorized ancestor remains; EXPIRED_UNRESOLVED should fire

export interface EscalationChainAnalysis {
  readonly status: EscalationChainStatus;
  readonly currentEntry: EscalationEntry | null;
  readonly latestExpiresAt: string;
}

/** Analyse the current state of the escalation chain for a configuration. */
export function analyseEscalationChain(
  entries: readonly EscalationEntry[],
  submittedAt: string,
  initialSlaBusinessDays: number,
  now: string,
): EscalationChainAnalysis {
  const initialDeadline = classifyReviewDeadline(submittedAt, initialSlaBusinessDays, now);

  if (entries.length === 0) {
    return {
      status: initialDeadline === 'OVERDUE' ? 'ESCALATED_OVERDUE' : 'AWAITING_INITIAL_REVIEW',
      currentEntry: null,
      latestExpiresAt: computeExpiryAt(submittedAt, initialSlaBusinessDays),
    };
  }

  // Sort by escalatedAt descending to find the most recent entry.
  const sorted = [...entries].sort((a, b) => b.escalatedAt.localeCompare(a.escalatedAt));
  const latest = sorted[0]!;

  if (latest.outcome !== 'PENDING') {
    // Chain resolved — this analysis is called on a stale chain; treat as exhausted.
    return {
      status: 'CHAIN_EXHAUSTED',
      currentEntry: latest,
      latestExpiresAt: latest.expiresAt,
    };
  }

  if (latest.toOrganizationId === null) {
    // No ancestor — chain exhausted; EXPIRED_UNRESOLVED should fire.
    return {
      status: 'CHAIN_EXHAUSTED',
      currentEntry: latest,
      latestExpiresAt: latest.expiresAt,
    };
  }

  const entryDeadline = classifyReviewDeadline(latest.escalatedAt, 3, now);
  return {
    status: entryDeadline === 'OVERDUE' ? 'ESCALATED_OVERDUE' : 'ESCALATED_PENDING',
    currentEntry: latest,
    latestExpiresAt: latest.expiresAt,
  };
}
