import type {
  IndustryPackVersion,
  IndustryPackVersionState,
} from './authoring.ts';

const ALLOWED: Readonly<Record<IndustryPackVersionState, readonly IndustryPackVersionState[]>> = {
  DRAFT: ['IN_REVIEW', 'ARCHIVED'],
  IN_REVIEW: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['SUPERSEDED', 'ARCHIVED'],
  SUPERSEDED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function canTransitionIndustryPackVersion(
  from: IndustryPackVersionState,
  to: IndustryPackVersionState,
): boolean {
  return ALLOWED[from].includes(to);
}

export interface TransitionIndustryPackVersionInput {
  readonly current: IndustryPackVersion;
  readonly to: IndustryPackVersionState;
  readonly actorSubjectId: string;
  readonly occurredAt: string;
}

export class IndustryPackLifecycleError extends Error {
  readonly code = 'INDUSTRY_PACK_STATE_TRANSITION_INVALID';

  constructor(from: IndustryPackVersionState, to: IndustryPackVersionState) {
    super(`Industry Pack version cannot transition from ${from} to ${to}.`);
    this.name = 'IndustryPackLifecycleError';
  }
}

/**
 * Pure lifecycle transition. Definition, identity, scope and draft revision are
 * never modified here; persistence applies the returned snapshot atomically.
 */
export function transitionIndustryPackVersion(
  input: TransitionIndustryPackVersionInput,
): IndustryPackVersion {
  const { current, to, actorSubjectId, occurredAt } = input;
  if (!canTransitionIndustryPackVersion(current.state, to)) {
    throw new IndustryPackLifecycleError(current.state, to);
  }

  return {
    ...current,
    state: to,
    updatedBySubjectId: actorSubjectId,
    updatedAt: occurredAt,
    ...(to === 'IN_REVIEW'
      ? {
          submittedBySubjectId: actorSubjectId,
          submittedAt: occurredAt,
        }
      : {}),
    ...(to === 'PUBLISHED'
      ? {
          publishedBySubjectId: actorSubjectId,
          publishedAt: occurredAt,
        }
      : {}),
  };
}
