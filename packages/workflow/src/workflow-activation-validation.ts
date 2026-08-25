import type {
  WorkflowActivationBlueprintDefinition,
  WorkflowActivationRequest,
} from './workflow-activation.ts';

export type WorkflowActivationValidationIssueCode =
  | 'ACTIVATION_BLUEPRINT_MISMATCH'
  | 'ACTIVATION_WORK_TYPE_MISMATCH'
  | 'ACTIVATION_RIGHTS_GRANTS_REQUIRED'
  | 'ACTIVATION_REQUESTED_AT_INVALID'
  | 'ACTIVATION_STEP_KEY_DUPLICATE'
  | 'ACTIVATION_STEP_SEQUENCE_INVALID'
  | 'ACTIVATION_STEP_ACTION_REQUIRED';

export interface WorkflowActivationValidationIssue {
  readonly code: WorkflowActivationValidationIssueCode;
  readonly field: string;
  readonly message: string;
}

export interface WorkflowActivationValidationResult {
  readonly valid: boolean;
  readonly issues: readonly WorkflowActivationValidationIssue[];
}

/** Pure validation only; this function performs no provisioning or persistence. */
export function validateWorkflowActivation(
  blueprint: WorkflowActivationBlueprintDefinition,
  request: WorkflowActivationRequest,
): WorkflowActivationValidationResult {
  const issues: WorkflowActivationValidationIssue[] = [];

  if (
    request.blueprint.blueprintKey !== blueprint.blueprintKey
    || request.blueprint.version !== blueprint.version
  ) {
    issues.push(issue(
      'ACTIVATION_BLUEPRINT_MISMATCH',
      'blueprint',
      'Activation must reference the exact blueprint key and version being validated.',
    ));
  }

  if (request.workTypeKey !== blueprint.workTypeKey) {
    issues.push(issue(
      'ACTIVATION_WORK_TYPE_MISMATCH',
      'workTypeKey',
      'Activation request work type must match the activation blueprint.',
    ));
  }

  if (request.sourceRightsGrantIds.length === 0) {
    issues.push(issue(
      'ACTIVATION_RIGHTS_GRANTS_REQUIRED',
      'sourceRightsGrantIds',
      'Activation requires at least one persisted source rights grant.',
    ));
  }

  if (!Number.isFinite(Date.parse(request.requestedAt))) {
    issues.push(issue(
      'ACTIVATION_REQUESTED_AT_INVALID',
      'requestedAt',
      'Activation requestedAt must be a valid instant.',
    ));
  }

  const stepKeys = new Set<string>();
  const sequences = new Set<number>();
  for (const step of blueprint.steps) {
    if (stepKeys.has(step.stepKey)) {
      issues.push(issue(
        'ACTIVATION_STEP_KEY_DUPLICATE',
        'steps',
        `Activation step key "${step.stepKey}" must be unique.`,
      ));
    }
    stepKeys.add(step.stepKey);

    if (!Number.isInteger(step.sequence) || step.sequence < 0 || sequences.has(step.sequence)) {
      issues.push(issue(
        'ACTIVATION_STEP_SEQUENCE_INVALID',
        'steps',
        'Activation step sequences must be unique non-negative integers.',
      ));
    }
    sequences.add(step.sequence);

    if (step.actionKey.trim() === '') {
      issues.push(issue(
        'ACTIVATION_STEP_ACTION_REQUIRED',
        'steps',
        `Activation step "${step.stepKey}" requires an action key.`,
      ));
    }
  }

  return { valid: issues.length === 0, issues };
}

function issue(
  code: WorkflowActivationValidationIssueCode,
  field: string,
  message: string,
): WorkflowActivationValidationIssue {
  return { code, field, message };
}
