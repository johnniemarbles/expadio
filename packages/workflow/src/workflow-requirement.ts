export type WorkflowRequirementState =
  | 'PENDING'
  | 'SATISFIED'
  | 'FAILED'
  | 'WAIVED'
  | 'EXPIRED';

export interface WorkflowRequirementWaiverStatus {
  readonly allowed: boolean;
  readonly applied: boolean;
  readonly waiverId?: string;
}

export interface WorkflowRequirementStatus {
  readonly requirementKey: string;
  readonly state: WorkflowRequirementState;
  /** Non-waivable invariants remain blocking even if an external waiver exists. */
  readonly waiver: WorkflowRequirementWaiverStatus;
  readonly code: string;
  readonly evidenceRefs: readonly string[];
}

export interface WorkflowRequirementResolutionContext {
  readonly tenantId: string;
  readonly instanceId: string;
  readonly workTypeKey: string;
  readonly stageKey: string;
}

/**
 * Resolves current requirement status for the exact keys declared by a stage.
 * Implementations may source evidence from compliance, documents, approvals or
 * vertical services without coupling those schemas into the workflow engine.
 */
export interface WorkflowRequirementStatusProvider {
  resolve(input: {
    readonly context: WorkflowRequirementResolutionContext;
    readonly requirementKeys: readonly string[];
  }): Promise<readonly WorkflowRequirementStatus[]>;
}

export function isWorkflowRequirementBlocking(
  status: WorkflowRequirementStatus,
): boolean {
  if (status.state === 'SATISFIED') return false;
  if (status.state === 'WAIVED') {
    return !(status.waiver.allowed && status.waiver.applied);
  }
  return true;
}
