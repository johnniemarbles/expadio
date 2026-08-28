import type {
  WorkflowApprovalAuthorityProvider,
  WorkflowApprovalAuthorityContext,
  WorkflowApprovalAuthorityDecision,
} from '@expadio/workflow';

/**
 * Role + separation-of-duties authority for stage decisions.
 *
 * Two rules, evaluated before the decision is ever persisted (a denial never
 * reaches the immutable decision table):
 *   1. Role authority — the approver must hold a governing role in the tenant;
 *      the satisfying role is recorded as authority evidence, so the decision
 *      record shows *under what role* it was approved.
 *   2. Separation of duties — the approver must not be the subject who advanced
 *      the case into the stage (four-eyes / maker-checker).
 *
 * The role lookup is injected so this stays free of a persistence dependency and
 * testable. Delegation, organization scope and monetary thresholds are further
 * requirements the same provider contract carries (context.requirements); they
 * are left for a later layer.
 */
export class RoleAndSeparationOfDutiesAuthorityProvider implements WorkflowApprovalAuthorityProvider {
  readonly #resolveRole: (subjectId: string) => Promise<string | null>;
  constructor(resolveRole: (subjectId: string) => Promise<string | null>) {
    this.#resolveRole = resolveRole;
  }

  async evaluate(context: WorkflowApprovalAuthorityContext): Promise<WorkflowApprovalAuthorityDecision> {
    const maker = context.requestedBySubjectId.trim();
    const checker = context.approverSubjectId.trim();

    const roleKey = await this.#resolveRole(checker);
    if (roleKey === null) {
      return {
        allowed: false,
        code: 'WORKFLOW_AUTHORITY_ROLE_MISSING',
        reason: 'The approver does not hold a governing role in this workspace.',
        evidenceRefs: [`authority:role:none:${checker}`],
      };
    }

    if (maker !== '' && checker !== '' && maker === checker) {
      return {
        allowed: false,
        code: 'WORKFLOW_SOD_SELF_APPROVAL',
        reason: 'The approver may not be the same person who advanced this case into the stage.',
        evidenceRefs: [`sod:conflict:${checker}`],
      };
    }

    return {
      allowed: true,
      code: 'WORKFLOW_AUTHORITY_OK',
      authority: {
        approverSubjectId: checker,
        roleKey,
        capturedAt: new Date().toISOString(),
        evidenceRefs: [`authority:role:${roleKey}`],
      },
      sodEvidenceRefs: maker === '' ? [`sod:checker:${checker}`] : [`sod:maker:${maker}`, `sod:checker:${checker}`],
    };
  }
}
