import type {
  WorkflowApprovalAuthorityProvider,
} from './workflow-approval-authority.ts';
import type {
  WorkflowDecisionCaptureInput,
  WorkflowDecisionCaptureResult,
  WorkflowDecisionCaptureService,
} from './workflow-decision-capture.ts';
import type {
  WorkflowStageDecisionRepository,
} from './workflow-decision-repository.ts';

/**
 * Framework-free decision capture orchestration.
 * Authority is evaluated before immutable persistence; denied requests never
 * reach the decision repository.
 */
export class AuthorityGatedWorkflowDecisionCaptureService
  implements WorkflowDecisionCaptureService {
  readonly #authority: WorkflowApprovalAuthorityProvider;
  readonly #decisions: WorkflowStageDecisionRepository;

  constructor(
    authority: WorkflowApprovalAuthorityProvider,
    decisions: WorkflowStageDecisionRepository,
  ) {
    this.#authority = authority;
    this.#decisions = decisions;
  }

  async capture(input: WorkflowDecisionCaptureInput): Promise<WorkflowDecisionCaptureResult> {
    const authority = await this.#authority.evaluate({
      tenantId: input.tenantId,
      instanceId: input.instanceId,
      workTypeKey: input.workTypeKey,
      stageKey: input.stageKey,
      proposedOutcome: input.outcome,
      requestedBySubjectId: input.requestedBySubjectId,
      approverSubjectId: input.approverSubjectId,
      requirements: input.authorityRequirements,
    });

    if (!authority.allowed) {
      return {
        status: 'AUTHORITY_DENIED',
        code: authority.code,
        reason: authority.reason,
        evidenceRefs: [...authority.evidenceRefs],
      };
    }

    const authorityEvidenceRefs = [...authority.authority.evidenceRefs];
    const sodEvidenceRefs = [...authority.sodEvidenceRefs];
    const commit = await this.#decisions.record({
      tenantId: input.tenantId,
      instanceId: input.instanceId,
      workTypeKey: input.workTypeKey,
      stageKey: input.stageKey,
      decisionId: input.decisionId,
      outcome: input.outcome,
      decidedBySubjectId: input.approverSubjectId,
      decidedAt: input.decidedAt,
      code: input.code,
      evidenceRefs: uniqueStrings([
        ...input.evidenceRefs,
        ...authorityEvidenceRefs,
        ...sodEvidenceRefs,
      ]),
    });

    if (commit.status === 'CONFLICT') {
      return { status: 'CONFLICT', existing: commit.existing };
    }

    return {
      status: commit.status,
      decision: commit.decision,
      authorityCode: authority.code,
      authorityEvidenceRefs,
      sodEvidenceRefs,
    };
  }
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
