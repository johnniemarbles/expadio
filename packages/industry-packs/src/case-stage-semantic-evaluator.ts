import type {
  CaseRelationshipConcept,
  CaseStageSemanticRequirement,
  CaseWorkflowSemantics,
  CrmCaseStage,
} from './index.ts';

export interface CaseStageSemanticFacts {
  readonly stageKey: CrmCaseStage;
  readonly phase: 'ENTRY' | 'EXIT';
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly relationships: readonly CaseRelationshipConcept[];
  readonly decisionOutcomes: readonly string[];
}

export type CaseStageSemanticBlockerCode =
  | 'CASE_SEMANTIC_ATTRIBUTE_REQUIRED'
  | 'CASE_SEMANTIC_RELATIONSHIP_REQUIRED'
  | 'CASE_SEMANTIC_DECISION_OUTCOME_REQUIRED';

export interface CaseStageSemanticBlocker {
  readonly code: CaseStageSemanticBlockerCode;
  readonly stageKey: CrmCaseStage;
  readonly phase: 'ENTRY' | 'EXIT';
  readonly key: string;
  readonly message: string;
}

export interface CaseStageSemanticEvaluation {
  readonly ok: boolean;
  readonly blockers: readonly CaseStageSemanticBlocker[];
}

/**
 * Evaluates one Pack's declarative stage semantics against already-resolved
 * canonical case facts. This function knows no vertical names and performs no
 * persistence or workflow mutation.
 */
export function evaluateCaseStageSemantics(
  semantics: CaseWorkflowSemantics,
  facts: CaseStageSemanticFacts,
): CaseStageSemanticEvaluation {
  const blockers: CaseStageSemanticBlocker[] = [];
  const relationships = new Set(facts.relationships);
  const decisions = new Set(facts.decisionOutcomes);

  for (const requirement of matchingRequirements(semantics, facts)) {
    for (const key of requirement.requiredAttributeKeys ?? []) {
      if (!hasMeaningfulValue(facts.attributes[key])) {
        blockers.push(blocker(
          'CASE_SEMANTIC_ATTRIBUTE_REQUIRED',
          requirement,
          key,
        ));
      }
    }

    for (const relationship of requirement.requiredRelationships ?? []) {
      if (!relationships.has(relationship)) {
        blockers.push(blocker(
          'CASE_SEMANTIC_RELATIONSHIP_REQUIRED',
          requirement,
          relationship,
        ));
      }
    }

    const acceptedOutcomes = requirement.requiredDecisionOutcomes ?? [];
    if (
      acceptedOutcomes.length > 0
      && !acceptedOutcomes.some((outcome) => decisions.has(outcome))
    ) {
      blockers.push(blocker(
        'CASE_SEMANTIC_DECISION_OUTCOME_REQUIRED',
        requirement,
        acceptedOutcomes.join('|'),
      ));
    }
  }

  return { ok: blockers.length === 0, blockers };
}

function matchingRequirements(
  semantics: CaseWorkflowSemantics,
  facts: CaseStageSemanticFacts,
): readonly CaseStageSemanticRequirement[] {
  return semantics.requirements.filter(
    (requirement) =>
      requirement.stageKey === facts.stageKey
      && requirement.phase === facts.phase,
  );
}

function blocker(
  code: CaseStageSemanticBlockerCode,
  requirement: CaseStageSemanticRequirement,
  key: string,
): CaseStageSemanticBlocker {
  return {
    code,
    stageKey: requirement.stageKey,
    phase: requirement.phase,
    key,
    message: requirement.message,
  };
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
