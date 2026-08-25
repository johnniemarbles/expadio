export type WorkflowProvisioningModel =
  | 'FULL_WORKSPACE'
  | 'SCOPED_WORKSPACE'
  | 'RESTRICTED_PORTAL'
  | 'ACCOUNT_ONLY'
  | 'NO_PROVISIONING';

export type WorkflowActivationVerificationState =
  | 'NOT_VERIFIED'
  | 'IN_PROGRESS'
  | 'VERIFIED'
  | 'FAILED';

export interface WorkflowActivationStepDefinition {
  readonly stepKey: string;
  readonly label: string;
  readonly sequence: number;
  readonly requiredBeforeActive: boolean;
  readonly actionKey: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface WorkflowActivationBlueprintDefinition {
  readonly blueprintKey: string;
  readonly version: number;
  readonly label: string;
  readonly workTypeKey: string;
  readonly provisioningModel: WorkflowProvisioningModel;
  readonly steps: readonly WorkflowActivationStepDefinition[];
}

export interface WorkflowActivationRequest {
  readonly tenantId: string;
  readonly instanceId: string;
  readonly workTypeKey: string;
  readonly activationId: string;
  readonly blueprint: {
    readonly blueprintKey: string;
    readonly version: number;
  };
  readonly sourceRightsGrantIds: readonly string[];
  readonly requestedBySubjectId: string;
  readonly requestedAt: string;
  readonly evidenceRefs: readonly string[];
}

export interface WorkflowActivationRecord {
  readonly tenantId: string;
  readonly instanceId: string;
  readonly workTypeKey: string;
  readonly activationId: string;
  readonly blueprintKey: string;
  readonly blueprintVersion: number;
  readonly provisioningModel: WorkflowProvisioningModel;
  readonly sourceRightsGrantIds: readonly string[];
  readonly verificationState: WorkflowActivationVerificationState;
  readonly provisionedResourceRefs: readonly string[];
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly verifiedBySubjectId?: string;
  readonly verifiedAt?: string;
  readonly verificationEvidenceRefs: readonly string[];
}

export type WorkflowActivationResult =
  | { readonly status: 'STARTED'; readonly activation: WorkflowActivationRecord }
  | { readonly status: 'ALREADY_STARTED'; readonly activation: WorkflowActivationRecord }
  | { readonly status: 'DENIED'; readonly code: string; readonly reason: string; readonly evidenceRefs: readonly string[] }
  | { readonly status: 'CONFLICT'; readonly existing: WorkflowActivationRecord };

/**
 * Activation/provisioning is an explicit operation after rights have been
 * granted. Approval and rights-grant persistence must never implicitly create
 * workspaces, accounts, portal access or entitlements.
 */
export interface WorkflowActivationService {
  activate(input: WorkflowActivationRequest): Promise<WorkflowActivationResult>;
}
