export type WorkflowActivationLifecycleState =
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'REVOKED';

export type WorkflowActivationLifecycleAction =
  | 'SUSPEND'
  | 'RESUME'
  | 'REVOKE';

export interface WorkflowActivationLifecycleRequest {
  readonly eventId: string;
  readonly tenantId: string;
  readonly instanceId: string;
  readonly activationId: string;
  readonly expectedFromState: WorkflowActivationLifecycleState;
  readonly action: WorkflowActivationLifecycleAction;
  readonly affectedRightsGrantIds: readonly string[];
  readonly monitoringTriggerKey: string;
  readonly sourceVerificationId?: string;
  readonly performedBySubjectId: string;
  readonly performedAt: string;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export interface WorkflowActivationLifecycleEvent {
  readonly eventId: string;
  readonly tenantId: string;
  readonly instanceId: string;
  readonly activationId: string;
  readonly fromState: WorkflowActivationLifecycleState;
  readonly toState: WorkflowActivationLifecycleState;
  readonly action: WorkflowActivationLifecycleAction;
  readonly affectedRightsGrantIds: readonly string[];
  readonly monitoringTriggerKey: string;
  readonly sourceVerificationId?: string;
  readonly performedBySubjectId: string;
  readonly performedAt: string;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export type WorkflowActivationLifecycleResult =
  | {
      readonly status: 'APPLIED';
      readonly event: WorkflowActivationLifecycleEvent;
    }
  | {
      readonly status: 'ALREADY_APPLIED';
      readonly event: WorkflowActivationLifecycleEvent;
    }
  | {
      readonly status: 'DENIED';
      readonly code: string;
      readonly reason: string;
      readonly evidenceRefs: readonly string[];
    }
  | {
      readonly status: 'CONFLICT';
      readonly currentState: WorkflowActivationLifecycleState;
    };

/**
 * Standing controls act on the activated relationship and its scoped rights.
 * They append lifecycle history and never reopen or rewrite the completed case.
 */
export interface WorkflowActivationLifecycleService {
  apply(
    input: WorkflowActivationLifecycleRequest,
  ): Promise<WorkflowActivationLifecycleResult>;
}
