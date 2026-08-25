import type {
  WorkflowRightsGrant,
  WorkflowRightsGrantRequest,
  WorkflowRightsGrantResult,
  WorkflowRightsGrantService,
} from './workflow-rights.ts';
import type { WorkflowRightsGrantRepository } from './workflow-rights-repository.ts';
import type { WorkflowRightsProfileProvider } from './workflow-rights-profile-provider.ts';
import { validateWorkflowRightsGrant } from './workflow-rights-validation.ts';

/** Validates and records rights; it deliberately performs no provisioning side effects. */
export class RepositoryWorkflowRightsGrantService implements WorkflowRightsGrantService {
  readonly #profiles: WorkflowRightsProfileProvider;
  readonly #repository: WorkflowRightsGrantRepository;
  readonly #now: () => string;

  constructor(input: {
    readonly profiles: WorkflowRightsProfileProvider;
    readonly repository: WorkflowRightsGrantRepository;
    readonly now?: () => string;
  }) {
    this.#profiles = input.profiles;
    this.#repository = input.repository;
    this.#now = input.now ?? (() => new Date().toISOString());
  }

  async grant(request: WorkflowRightsGrantRequest): Promise<WorkflowRightsGrantResult> {
    const profile = await this.#profiles.resolve({
      tenantId: request.tenantId,
      profileKey: request.profile.profileKey,
      version: request.profile.version,
    });

    if (profile === null) {
      return denied(
        'RIGHTS_PROFILE_NOT_FOUND',
        `Rights profile ${request.profile.profileKey}@${request.profile.version} was not found.`,
        request.evidenceRefs,
      );
    }

    const validation = validateWorkflowRightsGrant(profile, request);
    if (!validation.valid) {
      const first = validation.issues[0]!;
      return denied(first.code, first.message, request.evidenceRefs);
    }

    const grant: WorkflowRightsGrant = {
      tenantId: request.tenantId,
      instanceId: request.instanceId,
      workTypeKey: request.workTypeKey,
      grantId: request.grantId,
      ...(request.beneficiarySubjectId === undefined
        ? {}
        : { beneficiarySubjectId: request.beneficiarySubjectId }),
      ...(request.beneficiaryOrganizationId === undefined
        ? {}
        : { beneficiaryOrganizationId: request.beneficiaryOrganizationId }),
      profileKey: profile.profileKey,
      profileVersion: profile.version,
      rightTypes: [...request.rightTypes],
      scope: structuredClone(request.scope),
      ...(request.exclusivityKey === undefined ? {} : { exclusivityKey: request.exclusivityKey }),
      effectiveFrom: request.effectiveFrom,
      ...(request.effectiveUntil === undefined ? {} : { effectiveUntil: request.effectiveUntil }),
      ...(request.sourceDecisionId === undefined ? {} : { sourceDecisionId: request.sourceDecisionId }),
      ...(request.sourceAgreementId === undefined ? {} : { sourceAgreementId: request.sourceAgreementId }),
      ...(request.executionVerificationId === undefined
        ? {}
        : { executionVerificationId: request.executionVerificationId }),
      grantedBySubjectId: request.requestedBySubjectId,
      grantedAt: this.#now(),
      state: 'ACTIVE',
      evidenceRefs: [...request.evidenceRefs],
    };

    const committed = await this.#repository.record(grant);
    switch (committed.status) {
      case 'COMMITTED':
        return { status: 'GRANTED', grant: committed.grant };
      case 'ALREADY_RECORDED':
        return { status: 'ALREADY_GRANTED', grant: committed.grant };
      case 'CONFLICT':
        return { status: 'CONFLICT', existing: committed.existing };
    }
  }
}

function denied(
  code: string,
  reason: string,
  evidenceRefs: readonly string[],
): WorkflowRightsGrantResult {
  return { status: 'DENIED', code, reason, evidenceRefs: [...evidenceRefs] };
}
