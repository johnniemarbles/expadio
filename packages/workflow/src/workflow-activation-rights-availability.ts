import type { WorkflowActivationLifecycleState } from './workflow-activation-lifecycle.ts';

export interface WorkflowActivationRightsAvailabilityRequest {
  readonly tenantId: string;
  readonly instanceId: string;
  readonly activationId: string;
  readonly rightsGrantId: string;
}

export type WorkflowActivationRightsAvailabilityDecision =
  | {
      readonly available: true;
      readonly state: 'ACTIVE';
      readonly code: 'ACTIVATION_RIGHTS_ACTIVE';
      readonly evidenceRefs: readonly string[];
    }
  | {
      readonly available: false;
      readonly code: string;
      readonly state?: WorkflowActivationLifecycleState;
      readonly evidenceRefs: readonly string[];
    };

/**
 * Post-case guard for using rights carried by an activated relationship.
 * Callers combine this decision with canonical actor/action authorization.
 */
export interface WorkflowActivationRightsAvailabilityProvider {
  evaluate(
    request: WorkflowActivationRightsAvailabilityRequest,
  ): Promise<WorkflowActivationRightsAvailabilityDecision>;
}
