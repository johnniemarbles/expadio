export type WorkflowBlueprintSource = 'PLATFORM' | 'TENANT_CUSTOMIZED';

export type WorkflowBlueprintState =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'ACTIVE'
  | 'SUPERSEDED'
  | 'ARCHIVED';

export type WorkflowStageKind =
  | 'QUALIFICATION'
  | 'APPLICATION'
  | 'VALIDATION'
  | 'COMPLIANCE'
  | 'REVIEW'
  | 'NEGOTIATION'
  | 'RECOMMENDATION'
  | 'DECISION'
  | 'PRE_CONTRACT'
  | 'EXECUTION'
  | 'RIGHTS'
  | 'ACTIVATION'
  | 'VERIFICATION'
  | 'CUSTOM';

export type WorkflowRejectAction = 'RETURN' | 'TERMINATE' | 'ESCALATE';

export interface WorkflowCondition {
  readonly type: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface WorkflowStageDefinition {
  readonly stageKey: string;
  readonly label: string;
  readonly sequence: number;
  readonly kind: WorkflowStageKind;
  readonly isMandatory: boolean;
  readonly canBeDeactivated: boolean;
  readonly isParallel: boolean;
  readonly parallelGroupKey?: string;
  readonly requiredParticipantKeys: readonly string[];
  readonly decisionRequired: boolean;
  readonly decisionOutcomes: readonly string[];
  readonly entryConditions: readonly WorkflowCondition[];
  readonly exitConditions: readonly WorkflowCondition[];
  readonly blockingRequirementKeys: readonly string[];
  readonly slaPolicyKey?: string;
  readonly autoAdvance: boolean;
  readonly onReject: WorkflowRejectAction;
  readonly returnToStageKey?: string;
}

export interface WorkflowBlueprintIdentity {
  readonly blueprintKey: string;
  readonly version: number;
}

export interface WorkflowBlueprintDefinition extends WorkflowBlueprintIdentity {
  readonly label: string;
  readonly workTypeKey: string;
  readonly tenantId?: string;
  readonly source: WorkflowBlueprintSource;
  readonly parent?: WorkflowBlueprintIdentity;
  readonly state: WorkflowBlueprintState;
  readonly allowsStageAddition: boolean;
  readonly allowsStageReorder: boolean;
  readonly allowsStageDeactivation: boolean;
  readonly minimumRequiredStageKeys: readonly string[];
  readonly stages: readonly WorkflowStageDefinition[];
  readonly publishedBySubjectId?: string;
  readonly publishedAt?: string;
}

/**
 * Running workflow instances must refer to an explicit blueprint version.
 * Resolution of which version to use belongs to a later resolver contract.
 */
export interface PinnedWorkflowBlueprint {
  readonly blueprintKey: string;
  readonly version: number;
}

export * from './blueprint-validation.ts';
export * from './blueprint-instantiation.ts';
export * from './blueprint-repository.ts';
