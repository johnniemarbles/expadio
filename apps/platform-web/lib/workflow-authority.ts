import type {
  WorkflowApprovalAuthorityProvider,
  WorkflowApprovalAuthorityContext,
  WorkflowApprovalAuthorityDecision,
} from '@expadio/workflow';

/**
 * Separation-of-duties authority: four-eyes / maker-checker.
 *
 * The subject approving a stage decision must not be the same subject who
 * advanced the case into that stage. This is the recording authority the
 * decision-capture service consults before it persists — a denial never reaches
 * the immutable decision table.
 *
 * This deliberately enforces SoD only. Role authority dimensions, delegation,
 * organization scope and monetary thresholds are further requirements the same
 * provider contract can carry (context.requirements); they are out of scope
 * here and left for a later layer.
 */
export class SeparationOfDutiesAuthorityProvider implements WorkflowApprovalAuthorityProvider {
  async evaluate(context: WorkflowApprovalAuthorityContext): Promise<WorkflowApprovalAuthorityDecision> {
    const maker = context.requestedBySubjectId.trim();
    const checker = context.approverSubjectId.trim();

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
      code: 'WORKFLOW_SOD_OK',
      authority: {
        approverSubjectId: checker,
        capturedAt: new Date().toISOString(),
        evidenceRefs: [],
      },
      sodEvidenceRefs: maker === '' ? [`sod:checker:${checker}`] : [`sod:maker:${maker}`, `sod:checker:${checker}`],
    };
  }
}
