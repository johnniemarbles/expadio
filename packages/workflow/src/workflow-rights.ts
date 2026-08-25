export type WorkflowRightsGrantState =
  | 'PENDING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'REVOKED'
  | 'TRANSFERRED';

export interface WorkflowRightsScope {
  readonly organizationIds?: readonly string[];
  readonly territoryIds?: readonly string[];
  readonly channelKeys?: readonly string[];
  readonly productKeys?: readonly string[];
  readonly resourceRefs?: readonly string[];
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface WorkflowRightsProfileDefinition {
  readonly profileKey: string;
  readonly version: number;
  readonly label: string;
  readonly rightTypes: readonly string[];
  readonly maximumScope?: WorkflowRightsScope;
  readonly permitsExclusivity: boolean;
  readonly permitsDelegation: boolean;
  readonly permitsSubAppointment: boolean;
  readonly defaultDuration?: string;
  readonly renewalModel?: string;
}

export interface WorkflowRightsGrantRequest {
  readonly tenantId: string;
  readonly instanceId: string;
  readonly workTypeKey: string;
  readonly grantId: string;
  readonly beneficiarySubjectId?: string;
  readonly beneficiaryOrganizationId?: string;
  readonly profile: {
    readonly profileKey: string;
    readonly version: number;
  };
  readonly rightTypes: readonly string[];
  readonly scope: WorkflowRightsScope;
  readonly exclusivityKey?: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil?: string;
  /** Approval/decision evidence authorizes the grant request; it does not itself grant rights. */
  readonly sourceDecisionId?: string;
  readonly sourceAgreementId?: string;
  readonly executionVerificationId?: string;
  readonly requestedBySubjectId: string;
  readonly evidenceRefs: readonly string[];
}

export interface WorkflowRightsGrant {
  readonly tenantId: string;
  readonly instanceId: string;
  readonly workTypeKey: string;
  readonly grantId: string;
  readonly beneficiarySubjectId?: string;
  readonly beneficiaryOrganizationId?: string;
  readonly profileKey: string;
  readonly profileVersion: number;
  readonly rightTypes: readonly string[];
  readonly scope: WorkflowRightsScope;
  readonly exclusivityKey?: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil?: string;
  readonly sourceDecisionId?: string;
  readonly sourceAgreementId?: string;
  readonly executionVerificationId?: string;
  readonly grantedBySubjectId: string;
  readonly grantedAt: string;
  readonly state: WorkflowRightsGrantState;
  readonly evidenceRefs: readonly string[];
  readonly revokedAt?: string;
  readonly revokedBySubjectId?: string;
  readonly revocationReason?: string;
}

export type WorkflowRightsGrantResult =
  | { readonly status: 'GRANTED'; readonly grant: WorkflowRightsGrant }
  | { readonly status: 'ALREADY_GRANTED'; readonly grant: WorkflowRightsGrant }
  | { readonly status: 'DENIED'; readonly code: string; readonly reason: string; readonly evidenceRefs: readonly string[] }
  | { readonly status: 'CONFLICT'; readonly existing: WorkflowRightsGrant };

/**
 * Rights granting is a separate explicit operation from workflow approval.
 * Implementations must validate profile/scope/policy before creating a grant;
 * a recorded approval decision must never implicitly provision entitlements.
 */
export interface WorkflowRightsGrantService {
  grant(input: WorkflowRightsGrantRequest): Promise<WorkflowRightsGrantResult>;
}
