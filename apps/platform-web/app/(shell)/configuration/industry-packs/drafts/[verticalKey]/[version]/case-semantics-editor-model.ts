import {
  CASE_RELATIONSHIP_CONCEPTS,
  CRM_CASE_STAGES,
  type CaseRelationshipConcept,
  type CrmCaseStage,
} from '@expadio/industry-packs';

export interface DraftCaseSemanticRuleState {
  readonly stageKey: string;
  readonly phase: 'ENTRY' | 'EXIT';
  readonly requiredAttributeKeys: readonly string[];
  readonly requiredRelationships: readonly string[];
  readonly requiredDecisionOutcomes: readonly string[];
  readonly message: string;
}

export interface DraftCaseSemanticsEditorState {
  readonly rules: readonly DraftCaseSemanticRuleState[];
}

export interface DraftCaseSemanticRuleErrors {
  readonly stageKey?: string;
  readonly phase?: string;
  readonly requiredAttributeKeys?: string;
  readonly requiredRelationships?: string;
  readonly requiredDecisionOutcomes?: string;
  readonly requirement?: string;
  readonly message?: string;
}

export interface DraftCaseSemanticsEditorErrors {
  readonly rules?: Readonly<Record<number, DraftCaseSemanticRuleErrors>>;
}

export interface DraftCaseSemanticsDefinitionShape {
  readonly caseStageSemantics?: {
    readonly requirements: readonly {
      readonly stageKey: CrmCaseStage;
      readonly phase: 'ENTRY' | 'EXIT';
      readonly requiredAttributeKeys?: readonly string[];
      readonly requiredRelationships?: readonly CaseRelationshipConcept[];
      readonly requiredDecisionOutcomes?: readonly string[];
      readonly message: string;
    }[];
  };
}

const STAGES = new Set<string>(CRM_CASE_STAGES);
const RELATIONSHIPS = new Set<string>(CASE_RELATIONSHIP_CONCEPTS);

export function validateDraftCaseSemanticsEditorState(
  state: DraftCaseSemanticsEditorState,
  availableAttributeKeys: readonly string[],
): DraftCaseSemanticsEditorErrors {
  const allowedAttributes = new Set(availableAttributeKeys);
  const ruleErrors: Record<number, DraftCaseSemanticRuleErrors> = {};

  state.rules.forEach((rule, index) => {
    const errors: DraftCaseSemanticRuleErrors = {};

    if (!STAGES.has(rule.stageKey)) errors.stageKey = 'Choose a canonical case stage.';
    if (!['ENTRY', 'EXIT'].includes(rule.phase)) errors.phase = 'Choose ENTRY or EXIT.';

    if (hasDuplicatesOrBlank(rule.requiredAttributeKeys)) {
      errors.requiredAttributeKeys = 'Attribute requirements must be unique and non-empty.';
    } else if (rule.requiredAttributeKeys.some((key) => !allowedAttributes.has(key))) {
      errors.requiredAttributeKeys = 'Every required attribute must exist in the Pack case schema.';
    }

    if (hasDuplicatesOrBlank(rule.requiredRelationships)) {
      errors.requiredRelationships = 'Relationship requirements must be unique and non-empty.';
    } else if (rule.requiredRelationships.some((key) => !RELATIONSHIPS.has(key))) {
      errors.requiredRelationships = 'Use canonical CRM relationship keys only.';
    }

    if (hasDuplicatesOrBlank(rule.requiredDecisionOutcomes)) {
      errors.requiredDecisionOutcomes = 'Decision outcomes must be unique and non-empty.';
    }

    if (
      rule.requiredAttributeKeys.length === 0
      && rule.requiredRelationships.length === 0
      && rule.requiredDecisionOutcomes.length === 0
    ) {
      errors.requirement = 'Add at least one attribute, relationship, or decision requirement.';
    }

    if (rule.message.trim() === '') errors.message = 'Blocking message is required.';

    if (Object.keys(errors).length > 0) ruleErrors[index] = errors;
  });

  return Object.keys(ruleErrors).length === 0 ? {} : { rules: ruleErrors };
}

export function hasDraftCaseSemanticsEditorErrors(
  errors: DraftCaseSemanticsEditorErrors,
): boolean {
  return errors.rules !== undefined && Object.keys(errors.rules).length > 0;
}

/** Preserve every non-semantic Pack section while replacing only semantic rules. */
export function applyDraftCaseSemanticsEditorState<T extends DraftCaseSemanticsDefinitionShape>(
  definition: T,
  state: DraftCaseSemanticsEditorState,
): T {
  return {
    ...definition,
    caseStageSemantics: {
      requirements: state.rules.map((rule) => ({
        stageKey: rule.stageKey as CrmCaseStage,
        phase: rule.phase,
        ...(rule.requiredAttributeKeys.length === 0
          ? {}
          : { requiredAttributeKeys: uniqueTrimmed(rule.requiredAttributeKeys) }),
        ...(rule.requiredRelationships.length === 0
          ? {}
          : { requiredRelationships: uniqueTrimmed(rule.requiredRelationships) as CaseRelationshipConcept[] }),
        ...(rule.requiredDecisionOutcomes.length === 0
          ? {}
          : { requiredDecisionOutcomes: uniqueTrimmed(rule.requiredDecisionOutcomes) }),
        message: rule.message.trim(),
      })),
    },
  } as T;
}

export function draftCaseSemanticsStateFromDefinition(
  definition: DraftCaseSemanticsDefinitionShape,
): DraftCaseSemanticsEditorState {
  return {
    rules: (definition.caseStageSemantics?.requirements ?? []).map((rule) => ({
      stageKey: rule.stageKey,
      phase: rule.phase,
      requiredAttributeKeys: [...(rule.requiredAttributeKeys ?? [])],
      requiredRelationships: [...(rule.requiredRelationships ?? [])],
      requiredDecisionOutcomes: [...(rule.requiredDecisionOutcomes ?? [])],
      message: rule.message,
    })),
  };
}

function hasDuplicatesOrBlank(values: readonly string[]): boolean {
  const normalized = values.map((value) => value.trim());
  return normalized.some((value) => value === '') || new Set(normalized).size !== normalized.length;
}

function uniqueTrimmed(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
