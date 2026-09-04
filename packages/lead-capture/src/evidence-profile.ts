/**
 * Evidence / compliance model — ADR-017.
 *
 * An EvidenceProfile declares, per qualification criterion, the minimum
 * provenance level required for the scoring engine's verified-score mode.
 * Criteria that lack qualifying evidence are flagged; REQUIRED criteria that
 * block the verified score are surfaced separately so the product can show
 * "Initial score (self-declared)" vs "Verified score".
 *
 * This module is pure: no database, no network.
 */

import type {
  QualificationEvidenceSource,
  QualificationFact,
} from './qualification-provenance.ts';
import { QUALIFICATION_EVIDENCE_SOURCES } from './qualification-provenance.ts';

// ── Provenance ranking ────────────────────────────────────────────────────────

/**
 * Ordered rank of each evidence source, weakest to strongest.
 * Used by the scoring engine's provenanceFilter to compare sources.
 */
export const PROVENANCE_RANK: Readonly<Record<QualificationEvidenceSource, number>> = {
  SELF_DECLARED: 0,
  SYSTEM_DERIVED: 1,
  OPERATOR_ASSESSED: 2,
  DOCUMENT_VERIFIED: 3,
  EXTERNAL_VERIFIED: 4,
};

export function provenanceRank(source: QualificationEvidenceSource): number {
  return PROVENANCE_RANK[source];
}

/**
 * Returns true when `source` meets or exceeds `minimum` on the provenance scale.
 */
export function meetsMinimumProvenance(
  source: QualificationEvidenceSource,
  minimum: QualificationEvidenceSource,
): boolean {
  return PROVENANCE_RANK[source] >= PROVENANCE_RANK[minimum];
}

// ── Evidence requirement ──────────────────────────────────────────────────────

/**
 * How strongly a criterion's evidence requirement is enforced.
 *  REQUIRED    — the criterion must have qualifying evidence for the verified score to compute.
 *  CONDITIONAL — required only when another criterion triggers it (evaluated by caller).
 *  OPTIONAL    — qualifying evidence improves the verified score but is not blocking.
 */
export type EvidenceRequirementMode = 'REQUIRED' | 'CONDITIONAL' | 'OPTIONAL';

export interface EvidenceProfileRequirement {
  /** Qualification criterion this requirement applies to. */
  readonly criterionKey: string;
  /** Minimum evidence source level that counts as qualifying for verified scoring. */
  readonly minimumProvenanceLevel: QualificationEvidenceSource;
  readonly mode: EvidenceRequirementMode;
  /**
   * When true and the criterion has no qualifying fact, the verified score cannot
   * be computed. A REQUIRED criterion that is not met is always blocking.
   * An OPTIONAL criterion may be set blocking when it protects a compliance field.
   */
  readonly blocksVerifiedScore: boolean;
}

// ── Evidence profile ──────────────────────────────────────────────────────────

export type EvidenceProfileStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';

export interface EvidenceProfile {
  readonly evidenceProfileId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  /**
   * Key identifying this profile. Format: `evidence:<domain>:<variant>:<version>`
   * e.g. `evidence:franchise:standard:v1`.
   * The first two segments define the BOUNDED_SAME_DOMAIN override scope.
   */
  readonly profileKey: string;
  readonly name: string;
  readonly version: number;
  readonly requirements: readonly EvidenceProfileRequirement[];
  readonly status: EvidenceProfileStatus;
  readonly createdAt: string;
  readonly activatedAt: string | null;
  readonly retiredAt: string | null;
}

// ── Builder ───────────────────────────────────────────────────────────────────

export interface BuildEvidenceProfileOptions {
  readonly evidenceProfileId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly profileKey: string;
  readonly name: string;
  readonly version: number;
  readonly requirements: readonly EvidenceProfileRequirement[];
  readonly createdAt: string;
}

export class EvidenceProfileError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'EvidenceProfileError';
    this.code = code;
  }
}

const VALID_PROFILE_KEY = /^evidence:[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$/;

function requireNonBlank(value: string | null | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new EvidenceProfileError('MISSING_FIELD', `${field} is required and must not be blank.`);
  }
  return value.trim();
}

/**
 * Build an EvidenceProfile in DRAFT status, ready for activation.
 * Throws EvidenceProfileError if the profile key format is invalid, the
 * requirement list is empty, or any criterion key is duplicated.
 */
export function buildEvidenceProfile(options: BuildEvidenceProfileOptions): EvidenceProfile {
  const evidenceProfileId = requireNonBlank(options.evidenceProfileId, 'evidenceProfileId');
  const tenantId = requireNonBlank(options.tenantId, 'tenantId');
  const organizationId = requireNonBlank(options.organizationId, 'organizationId');
  const name = requireNonBlank(options.name, 'name');
  const createdAt = requireNonBlank(options.createdAt, 'createdAt');

  const profileKey = requireNonBlank(options.profileKey, 'profileKey');
  if (!VALID_PROFILE_KEY.test(profileKey)) {
    throw new EvidenceProfileError(
      'INVALID_PROFILE_KEY',
      `profileKey must match evidence:<domain>:<variant>:<version> (e.g. evidence:franchise:standard:v1). Got: "${profileKey}".`,
    );
  }

  if (!Number.isInteger(options.version) || options.version < 1) {
    throw new EvidenceProfileError('INVALID_VERSION', 'version must be a positive integer.');
  }

  if (!Array.isArray(options.requirements) || options.requirements.length === 0) {
    throw new EvidenceProfileError(
      'EMPTY_REQUIREMENTS',
      'An EvidenceProfile must have at least one requirement.',
    );
  }

  const seen = new Set<string>();
  for (const req of options.requirements) {
    const key = requireNonBlank(req.criterionKey, 'requirement.criterionKey');
    if (seen.has(key)) {
      throw new EvidenceProfileError(
        'DUPLICATE_CRITERION_KEY',
        `Duplicate criterionKey in requirements: "${key}".`,
      );
    }
    seen.add(key);
    if (!(QUALIFICATION_EVIDENCE_SOURCES as readonly string[]).includes(req.minimumProvenanceLevel)) {
      throw new EvidenceProfileError(
        'UNKNOWN_PROVENANCE_LEVEL',
        `Unknown minimumProvenanceLevel: "${req.minimumProvenanceLevel}".`,
      );
    }
    if (!['REQUIRED', 'CONDITIONAL', 'OPTIONAL'].includes(req.mode)) {
      throw new EvidenceProfileError('UNKNOWN_MODE', `Unknown mode: "${req.mode}".`);
    }
  }

  return {
    evidenceProfileId,
    tenantId,
    organizationId,
    profileKey,
    name,
    version: options.version,
    requirements: options.requirements,
    status: 'DRAFT',
    createdAt,
    activatedAt: null,
    retiredAt: null,
  };
}

// ── Provenance filter — scoring engine integration ────────────────────────────

export interface ProvenanceFilterResult {
  /** The criterion this result covers. */
  readonly criterionKey: string;
  /**
   * The fact with the strongest provenance for this criterion among all available
   * facts, or null if no fact exists.
   */
  readonly strongestFact: QualificationFact | null;
  /**
   * Whether `strongestFact` meets the profile's `minimumProvenanceLevel` for this
   * criterion. False when no fact exists or provenance rank is below minimum.
   */
  readonly meetsRequirement: boolean;
  readonly requirementMode: EvidenceRequirementMode;
  /**
   * True when this criterion's unmet requirement prevents the verified score from
   * being computed. Only set to true when `meetsRequirement` is false.
   */
  readonly blocksVerifiedScore: boolean;
}

export interface ProvenanceSummary {
  readonly results: readonly ProvenanceFilterResult[];
  /** True when at least one result has blocksVerifiedScore = true. */
  readonly verifiedScoreBlocked: boolean;
  /** Criterion keys that block the verified score. */
  readonly blockingCriteria: readonly string[];
}

/**
 * Apply an EvidenceProfile to a set of qualification facts for one lead.
 * Returns per-requirement analysis used by the scoring engine to compute whether
 * a verified score can be produced and which criteria are unresolved.
 *
 * For each requirement the function selects the fact with the highest provenance
 * rank (regardless of response value — provenance selection is orthogonal to
 * criterion response; the scoring engine applies response weights separately).
 */
export function applyProvenanceFilter(
  facts: readonly QualificationFact[],
  profile: EvidenceProfile,
): ProvenanceSummary {
  // Build a lookup: criterionKey → strongest fact by provenance rank
  const strongest = new Map<string, QualificationFact>();
  for (const fact of facts) {
    const existing = strongest.get(fact.criterionKey);
    if (
      existing === undefined ||
      provenanceRank(fact.evidenceSource) > provenanceRank(existing.evidenceSource)
    ) {
      strongest.set(fact.criterionKey, fact);
    }
  }

  const results: ProvenanceFilterResult[] = [];
  for (const req of profile.requirements) {
    const strongestFact = strongest.get(req.criterionKey) ?? null;
    const meetsRequirement =
      strongestFact !== null &&
      meetsMinimumProvenance(strongestFact.evidenceSource, req.minimumProvenanceLevel);

    results.push({
      criterionKey: req.criterionKey,
      strongestFact,
      meetsRequirement,
      requirementMode: req.mode,
      blocksVerifiedScore: req.blocksVerifiedScore && !meetsRequirement,
    });
  }

  const blockingCriteria = results
    .filter((r) => r.blocksVerifiedScore)
    .map((r) => r.criterionKey);

  return {
    results,
    verifiedScoreBlocked: blockingCriteria.length > 0,
    blockingCriteria,
  };
}
