import type {
  WorkflowRightsGrantRequest,
  WorkflowRightsProfileDefinition,
  WorkflowRightsScope,
} from './workflow-rights.ts';

export type WorkflowRightsValidationIssueCode =
  | 'RIGHTS_PROFILE_MISMATCH'
  | 'RIGHTS_BENEFICIARY_INVALID'
  | 'RIGHTS_TYPE_NOT_PERMITTED'
  | 'RIGHTS_EXCLUSIVITY_NOT_PERMITTED'
  | 'RIGHTS_SCOPE_EXCEEDS_PROFILE'
  | 'RIGHTS_EFFECTIVE_RANGE_INVALID';

export interface WorkflowRightsValidationIssue {
  readonly code: WorkflowRightsValidationIssueCode;
  readonly field: string;
  readonly message: string;
}

export interface WorkflowRightsValidationResult {
  readonly valid: boolean;
  readonly issues: readonly WorkflowRightsValidationIssue[];
}

export function validateWorkflowRightsGrant(
  profile: WorkflowRightsProfileDefinition,
  request: WorkflowRightsGrantRequest,
): WorkflowRightsValidationResult {
  const issues: WorkflowRightsValidationIssue[] = [];

  if (
    request.profile.profileKey !== profile.profileKey
    || request.profile.version !== profile.version
  ) {
    issues.push(issue(
      'RIGHTS_PROFILE_MISMATCH',
      'profile',
      'Grant request must reference the exact rights profile key and version being validated.',
    ));
  }

  const beneficiaryCount = Number(request.beneficiarySubjectId !== undefined)
    + Number(request.beneficiaryOrganizationId !== undefined);
  if (beneficiaryCount !== 1) {
    issues.push(issue(
      'RIGHTS_BENEFICIARY_INVALID',
      'beneficiary',
      'Grant request must identify exactly one beneficiary subject or organization.',
    ));
  }

  const allowedRightTypes = new Set(profile.rightTypes);
  for (const rightType of request.rightTypes) {
    if (!allowedRightTypes.has(rightType)) {
      issues.push(issue(
        'RIGHTS_TYPE_NOT_PERMITTED',
        'rightTypes',
        `Right type "${rightType}" is not permitted by profile ${profile.profileKey}@${profile.version}.`,
      ));
    }
  }

  if (request.exclusivityKey !== undefined && !profile.permitsExclusivity) {
    issues.push(issue(
      'RIGHTS_EXCLUSIVITY_NOT_PERMITTED',
      'exclusivityKey',
      'The selected rights profile does not permit exclusivity.',
    ));
  }

  if (
    profile.maximumScope !== undefined
    && !scopeWithinMaximum(request.scope, profile.maximumScope)
  ) {
    issues.push(issue(
      'RIGHTS_SCOPE_EXCEEDS_PROFILE',
      'scope',
      'Requested rights scope exceeds the maximum scope permitted by the profile.',
    ));
  }

  if (request.effectiveUntil !== undefined) {
    const from = Date.parse(request.effectiveFrom);
    const until = Date.parse(request.effectiveUntil);
    if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) {
      issues.push(issue(
        'RIGHTS_EFFECTIVE_RANGE_INVALID',
        'effectiveUntil',
        'effectiveUntil must be a valid instant later than effectiveFrom.',
      ));
    }
  }

  return { valid: issues.length === 0, issues };
}

function scopeWithinMaximum(
  requested: WorkflowRightsScope,
  maximum: WorkflowRightsScope,
): boolean {
  return subset(requested.organizationIds, maximum.organizationIds)
    && subset(requested.territoryIds, maximum.territoryIds)
    && subset(requested.channelKeys, maximum.channelKeys)
    && subset(requested.productKeys, maximum.productKeys)
    && subset(requested.resourceRefs, maximum.resourceRefs);
}

function subset(
  requested: readonly string[] | undefined,
  maximum: readonly string[] | undefined,
): boolean {
  if (requested === undefined || requested.length === 0) return true;
  if (maximum === undefined) return false;
  const allowed = new Set(maximum);
  return requested.every((value) => allowed.has(value));
}

function issue(
  code: WorkflowRightsValidationIssueCode,
  field: string,
  message: string,
): WorkflowRightsValidationIssue {
  return { code, field, message };
}
