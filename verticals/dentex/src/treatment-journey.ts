import {
  DENTEX_PACK,
  evaluateCaseStageSemantics,
  resolveCaseSchema,
  resolveCaseStageSemantics,
  validateCaseAttributes,
  type CaseAttributeValidation,
  type CaseStageSemanticEvaluation,
  type CrmCaseStage,
} from '@expadio/industry-packs';

export interface DentexTreatmentFacts {
  readonly stage: CrmCaseStage;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly patientLinked: boolean;
  readonly practiceLinked: boolean;
  readonly carePlanLinked: boolean;
  readonly decisionOutcomes: readonly string[];
}

/**
 * Validate DENTEX treatment attributes against the governed DENTEX case schema.
 * This remains a vertical adapter over the horizontal Industry Pack runtime.
 */
export function validateDentexTreatmentAttributes(
  attributes: Readonly<Record<string, unknown>>,
): CaseAttributeValidation {
  return validateCaseAttributes(resolveCaseSchema(DENTEX_PACK), { ...attributes });
}

/**
 * Evaluate the domain facts required to leave one DENTEX treatment stage.
 * Canonical relationship and decision keys are preserved; only the DENTEX pack
 * supplies the semantics.
 */
export function evaluateDentexTreatmentStageExit(
  facts: DentexTreatmentFacts,
): CaseStageSemanticEvaluation {
  const relationships = [
    ...(facts.patientLinked ? ['crm.contact' as const] : []),
    ...(facts.practiceLinked ? ['crm.account' as const] : []),
    ...(facts.carePlanLinked ? ['crm.agreement' as const] : []),
  ];

  return evaluateCaseStageSemantics(resolveCaseStageSemantics(DENTEX_PACK), {
    stageKey: facts.stage,
    phase: 'EXIT',
    attributes: facts.attributes,
    relationships,
    decisionOutcomes: facts.decisionOutcomes,
  });
}
