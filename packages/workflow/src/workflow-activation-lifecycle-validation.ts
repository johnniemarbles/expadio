import type {
  WorkflowActivationLifecycleRequest,
  WorkflowActivationLifecycleState,
} from './workflow-activation-lifecycle.ts';

export type WorkflowActivationLifecycleIssueCode =
  | 'ACTIVATION_LIFECYCLE_EVENT_ID_REQUIRED'
  | 'ACTIVATION_LIFECYCLE_TRANSITION_INVALID'
  | 'ACTIVATION_LIFECYCLE_RIGHTS_REQUIRED'
  | 'ACTIVATION_LIFECYCLE_RIGHTS_DUPLICATE'
  | 'ACTIVATION_LIFECYCLE_TRIGGER_REQUIRED'
  | 'ACTIVATION_LIFECYCLE_ACTOR_REQUIRED'
  | 'ACTIVATION_LIFECYCLE_OCCURRED_AT_INVALID'
  | 'ACTIVATION_LIFECYCLE_REASON_REQUIRED'
  | 'ACTIVATION_LIFECYCLE_EVIDENCE_REQUIRED'
  | 'ACTIVATION_LIFECYCLE_VERIFICATION_ID_INVALID';

export interface WorkflowActivationLifecycleIssue {
  readonly code: WorkflowActivationLifecycleIssueCode;
  readonly field: string;
  readonly message: string;
}

export type WorkflowActivationLifecycleValidationResult =
  | {
      readonly valid: true;
      readonly toState: WorkflowActivationLifecycleState;
      readonly issues: readonly [];
    }
  | {
      readonly valid: false;
      readonly issues: readonly WorkflowActivationLifecycleIssue[];
    };

/** Pure lifecycle validation; performs no persistence or entitlement mutation. */
export function validateWorkflowActivationLifecycle(
  request: WorkflowActivationLifecycleRequest,
): WorkflowActivationLifecycleValidationResult {
  const issues: WorkflowActivationLifecycleIssue[] = [];
  const toState = resolveTransition(request.expectedFromState, request.action);

  requiredText(request.eventId, 'eventId', 'ACTIVATION_LIFECYCLE_EVENT_ID_REQUIRED', issues);
  requiredText(request.monitoringTriggerKey, 'monitoringTriggerKey', 'ACTIVATION_LIFECYCLE_TRIGGER_REQUIRED', issues);
  requiredText(request.performedBySubjectId, 'performedBySubjectId', 'ACTIVATION_LIFECYCLE_ACTOR_REQUIRED', issues);
  requiredText(request.reason, 'reason', 'ACTIVATION_LIFECYCLE_REASON_REQUIRED', issues);

  if (toState === null) {
    issues.push(issue(
      'ACTIVATION_LIFECYCLE_TRANSITION_INVALID',
      'action',
      `Lifecycle action ${request.action} is invalid from ${request.expectedFromState}.`,
    ));
  }

  if (request.affectedRightsGrantIds.length === 0) {
    issues.push(issue(
      'ACTIVATION_LIFECYCLE_RIGHTS_REQUIRED',
      'affectedRightsGrantIds',
      'Lifecycle action requires at least one affected rights grant.',
    ));
  } else if (
    new Set(request.affectedRightsGrantIds).size
      !== request.affectedRightsGrantIds.length
  ) {
    issues.push(issue(
      'ACTIVATION_LIFECYCLE_RIGHTS_DUPLICATE',
      'affectedRightsGrantIds',
      'Affected rights grant identities must be unique.',
    ));
  }

  if (!Number.isFinite(Date.parse(request.performedAt))) {
    issues.push(issue(
      'ACTIVATION_LIFECYCLE_OCCURRED_AT_INVALID',
      'performedAt',
      'Lifecycle performedAt must be a valid instant.',
    ));
  }

  if (
    request.evidenceRefs.length === 0
    || request.evidenceRefs.some((entry) => entry.trim() === '')
  ) {
    issues.push(issue(
      'ACTIVATION_LIFECYCLE_EVIDENCE_REQUIRED',
      'evidenceRefs',
      'Lifecycle action requires non-empty evidence references.',
    ));
  }

  if (
    request.sourceVerificationId !== undefined
    && request.sourceVerificationId.trim() === ''
  ) {
    issues.push(issue(
      'ACTIVATION_LIFECYCLE_VERIFICATION_ID_INVALID',
      'sourceVerificationId',
      'Source verification identity cannot be empty.',
    ));
  }

  return issues.length === 0
    ? { valid: true, toState: toState!, issues: [] }
    : { valid: false, issues };
}

function resolveTransition(
  from: WorkflowActivationLifecycleState,
  action: WorkflowActivationLifecycleRequest['action'],
): WorkflowActivationLifecycleState | null {
  if (from === 'ACTIVE' && action === 'SUSPEND') return 'SUSPENDED';
  if (from === 'ACTIVE' && action === 'REVOKE') return 'REVOKED';
  if (from === 'SUSPENDED' && action === 'RESUME') return 'ACTIVE';
  if (from === 'SUSPENDED' && action === 'REVOKE') return 'REVOKED';
  return null;
}

function requiredText(
  value: string,
  field: string,
  code: WorkflowActivationLifecycleIssueCode,
  issues: WorkflowActivationLifecycleIssue[],
): void {
  if (value.trim() === '') {
    issues.push(issue(code, field, `Lifecycle ${field} is required.`));
  }
}

function issue(
  code: WorkflowActivationLifecycleIssueCode,
  field: string,
  message: string,
): WorkflowActivationLifecycleIssue {
  return { code, field, message };
}
