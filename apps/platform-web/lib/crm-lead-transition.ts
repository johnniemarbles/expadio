import { createHash } from 'node:crypto';
import {
  classifyLeadTransition,
  leadTransitionRequiresReason,
  type LeadStage,
  type LeadTransitionKind,
} from '@expadio/lead';

/**
 * CRM lead stage-transition governance helpers (Gate 4).
 *
 * The legal-transition graph lives in @expadio/lead; this module adds the hash
 * chaining and the plan/decision the route applies. Pure — no database.
 */

export interface TransitionDecision {
  readonly kind: LeadTransitionKind;
  readonly ok: boolean;
  readonly reasonCode?: 'ILLEGAL_TRANSITION' | 'TRANSITION_REASON_REQUIRED' | 'REVISION_CONFLICT';
  readonly message?: string;
}

/**
 * Decide whether a requested transition may proceed. `expectedRevision` is
 * optional; when supplied it must equal the lead's current revision (optimistic
 * concurrency — a stale editor is rejected rather than silently overwriting).
 */
export function decideLeadTransition(input: {
  readonly from: LeadStage;
  readonly to: LeadStage;
  readonly reason: string | null;
  readonly currentRevision: number;
  readonly expectedRevision?: number | null;
}): TransitionDecision {
  if (input.expectedRevision != null && input.expectedRevision !== input.currentRevision) {
    return { kind: 'ILLEGAL', ok: false, reasonCode: 'REVISION_CONFLICT', message: 'This lead changed since you loaded it. Reload and try again.' };
  }
  const kind = classifyLeadTransition(input.from, input.to);
  if (kind === 'ILLEGAL') {
    return { kind, ok: false, reasonCode: 'ILLEGAL_TRANSITION', message: `Cannot move a lead from ${input.from} to ${input.to}.` };
  }
  if (leadTransitionRequiresReason(kind) && !input.reason) {
    return { kind, ok: false, reasonCode: 'TRANSITION_REASON_REQUIRED', message: 'This transition requires a reason.' };
  }
  return { kind, ok: true };
}

/**
 * Compute the tamper-evident chain hash for a transition entry. The hash covers
 * the prior entry's hash plus the immutable fields of this entry, so any edit to
 * history breaks the chain.
 */
export function leadTransitionEntryHash(input: {
  readonly prevHash: string | null;
  readonly leadId: string;
  readonly fromStage: string;
  readonly toStage: string;
  readonly transitionKind: string;
  readonly reason: string | null;
  readonly actorSubjectId: string;
  readonly toRevision: number;
  readonly occurredAt: string;
}): string {
  const payload = [
    input.prevHash ?? '',
    input.leadId,
    input.fromStage,
    input.toStage,
    input.transitionKind,
    input.reason ?? '',
    input.actorSubjectId,
    String(input.toRevision),
    input.occurredAt,
  ].join('\n');
  return createHash('sha256').update(payload).digest('hex');
}
