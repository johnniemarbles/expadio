import type {
  WorkflowApprovalAuthorityProvider,
  WorkflowApprovalAuthorityContext,
  WorkflowApprovalAuthorityDecision,
  WorkflowAuthorityRequirement,
} from '@expadio/workflow';
import type { AuthorityGrant } from './workflow-authority-grants';

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
  readonly #resolveGrants: (subjectId: string) => Promise<AuthorityGrant[]>;
  constructor(
    resolveRole: (subjectId: string) => Promise<string | null>,
    resolveGrants: (subjectId: string) => Promise<AuthorityGrant[]> = async () => [],
  ) {
    this.#resolveRole = resolveRole;
    this.#resolveGrants = resolveGrants;
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

    const evidence: string[] = [`authority:role:${roleKey}`];

    // Requirement dimensions (monetary threshold, org scope, delegation).
    const requirements = context.requirements ?? [];
    if (requirements.length > 0) {
      const grants = await this.#resolveGrants(checker);
      for (const requirement of requirements) {
        const outcome = evaluateRequirement(requirement, grants);
        if (!outcome.satisfied) {
          return {
            allowed: false,
            code: outcome.code,
            reason: outcome.reason,
            evidenceRefs: outcome.evidenceRefs,
          };
        }
        evidence.push(...outcome.evidenceRefs);
      }
    }

    return {
      allowed: true,
      code: 'WORKFLOW_AUTHORITY_OK',
      authority: {
        approverSubjectId: checker,
        roleKey,
        capturedAt: new Date().toISOString(),
        evidenceRefs: evidence,
      },
      sodEvidenceRefs: maker === '' ? [`sod:checker:${checker}`] : [`sod:maker:${maker}`, `sod:checker:${checker}`],
    };
  }
}

interface RequirementOutcome {
  readonly satisfied: boolean;
  readonly code: string;
  readonly reason: string;
  readonly evidenceRefs: string[];
}

// Org scope entities are UUIDs; compare case-insensitively (a uuid column is
// stored lower-cased, a text column preserves the caller's case).
function sameEntity(a: string | null | undefined, b: string | null | undefined): boolean {
  return a !== null && a !== undefined && b !== null && b !== undefined && a.toLowerCase() === b.toLowerCase();
}

/** True if a grant's scope covers the requirement's scope. */
function scopeCovers(grant: AuthorityGrant, requirement: WorkflowAuthorityRequirement): boolean {
  if (grant.scopeType === 'TENANT') return true; // tenant-wide covers everything
  // An organization-scoped grant only covers a matching organization requirement.
  return requirement.scopeType === 'ORGANIZATION' && sameEntity(grant.scopeEntityId, requirement.scopeEntityId);
}

function evaluateRequirement(requirement: WorkflowAuthorityRequirement, grants: readonly AuthorityGrant[]): RequirementOutcome {
  if (requirement.dimensionKey === 'monetary.approval') {
    const currency = requirement.unit;
    const applicable = grants.filter((g) =>
      g.dimensionKey === 'monetary.approval'
      && (currency === undefined || g.currency === currency)
      && scopeCovers(g, requirement),
    );
    // A monetary grant is a ceiling; the subject's authority is the highest one.
    let ceiling = 0;
    let winner: AuthorityGrant | undefined;
    for (const g of applicable) {
      const t = g.thresholdMinorUnits ?? 0;
      if (t >= ceiling) { ceiling = t; winner = g; }
    }
    if (ceiling < requirement.requiredValue) {
      return {
        satisfied: false,
        code: 'WORKFLOW_AUTHORITY_THRESHOLD',
        reason: `The approver's approval authority (${ceiling}) is below the required ${requirement.requiredValue}${currency ? ' ' + currency : ''}.`,
        evidenceRefs: [`authority:monetary:ceiling:${ceiling}:required:${requirement.requiredValue}`],
      };
    }
    const refs = [`authority:monetary:ceiling:${ceiling}:required:${requirement.requiredValue}`];
    if (winner?.scopeType === 'ORGANIZATION') refs.push(`authority:scope:org:${winner.scopeEntityId}`);
    if (winner?.delegatedFromSubjectId) refs.push(`authority:delegation:${winner.delegatedFromSubjectId}`);
    return { satisfied: true, code: 'WORKFLOW_AUTHORITY_THRESHOLD_OK', reason: '', evidenceRefs: refs };
  }

  // Fail closed on an authority requirement dimension we cannot evaluate.
  return {
    satisfied: false,
    code: 'WORKFLOW_AUTHORITY_REQUIREMENT_UNKNOWN',
    reason: `Unrecognized authority requirement "${requirement.dimensionKey}".`,
    evidenceRefs: [`authority:requirement:${requirement.dimensionKey}:unknown`],
  };
}
