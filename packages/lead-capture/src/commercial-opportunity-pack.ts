/**
 * Commercial Opportunity Industry Pack — Platform-default qualification criteria
 * and evidence requirements for all six commercial interest types.
 *
 * This module is the Platform layer in the ADR-017 configuration hierarchy:
 *
 *   Platform defaults (this module)
 *       ↓ Industry Pack seeded from registry keys
 *   Brand HQ LeadManagementConfiguration (may tighten; never weaken)
 *       ↓ child override within declared bounds
 *   Country / Region / Unit configurations
 *
 * The constants here map every unique qualificationProfileKey and
 * evidenceProfileKey from the InterestTypeRegistry to:
 *   - PlatformQualificationCriteria: ordered criterion definitions used to seed
 *     the lead_qualification_templates table for Brand HQ.
 *   - PlatformEvidenceRequirements: EvidenceProfileRequirement[] used to seed
 *     the lead_evidence_profiles + lead_evidence_requirements tables for Brand HQ.
 *
 * Both maps are pure constants — no database, no network.
 */

import type { EvidenceProfileRequirement } from './evidence-profile.ts';
import type { QualificationEvidenceSource } from './qualification-provenance.ts';

// ── Qualification criterion ───────────────────────────────────────────────────

export interface PlatformQualificationCriterion {
  /** Stable snake_case key; referenced by EvidenceProfileRequirement.criterionKey. */
  readonly criterionKey: string;
  readonly label: string;
  readonly description: string;
}

export interface PlatformQualificationProfile {
  readonly profileKey: string;
  readonly criteria: readonly PlatformQualificationCriterion[];
}

// ── Shared criterion definitions ──────────────────────────────────────────────

// Investment / financial
const INVESTMENT_CAPACITY: PlatformQualificationCriterion = {
  criterionKey: 'investment_capacity',
  label: 'Investment Capacity',
  description: 'Applicant can fund the total investment required, including initial fees, fit-out, and working capital.',
};
const LIQUID_CAPITAL: PlatformQualificationCriterion = {
  criterionKey: 'liquid_capital',
  label: 'Liquid Capital',
  description: 'Applicant holds sufficient unencumbered liquid capital at the time of application.',
};
const NET_WORTH: PlatformQualificationCriterion = {
  criterionKey: 'net_worth',
  label: 'Net Worth',
  description: 'Total personal or entity net worth meets the minimum threshold for this opportunity.',
};

// Operational
const OPERATIONAL_COMMITMENT: PlatformQualificationCriterion = {
  criterionKey: 'operational_commitment',
  label: 'Operational Commitment',
  description: 'Applicant will be actively involved in day-to-day operations (not a passive investor).',
};
const PRIOR_BUSINESS_EXPERIENCE: PlatformQualificationCriterion = {
  criterionKey: 'prior_business_experience',
  label: 'Prior Business Experience',
  description: 'Applicant has prior experience owning or managing a business.',
};

// Multi-unit / master
const MULTI_UNIT_EXPERIENCE: PlatformQualificationCriterion = {
  criterionKey: 'multi_unit_experience',
  label: 'Multi-Unit Experience',
  description: 'Applicant has operated multiple franchise units or an equivalent multi-site business.',
};
const TERRITORY_MANAGEMENT_CAPACITY: PlatformQualificationCriterion = {
  criterionKey: 'territory_management_capacity',
  label: 'Territory Management Capacity',
  description: 'Applicant has the organizational capacity to develop and manage sub-franchisees across the territory.',
};
const LEGAL_ENTITY_SUITABILITY: PlatformQualificationCriterion = {
  criterionKey: 'legal_entity_suitability',
  label: 'Legal Entity Suitability',
  description: 'The applicant\'s legal entity structure is suitable for a master franchise agreement.',
};

// Area development
const AREA_DEVELOPMENT_CAPITAL: PlatformQualificationCriterion = {
  criterionKey: 'area_development_capital',
  label: 'Area Development Capital',
  description: 'Applicant has sufficient capital to fund the committed area development schedule.',
};
const MANAGEMENT_TEAM: PlatformQualificationCriterion = {
  criterionKey: 'management_team',
  label: 'Management Team',
  description: 'Applicant has or will hire a management team capable of running area operations.',
};

// Conversion
const EXISTING_BUSINESS_COMPATIBILITY: PlatformQualificationCriterion = {
  criterionKey: 'existing_business_compatibility',
  label: 'Existing Business Compatibility',
  description: 'The applicant\'s existing business operations are compatible with conversion to this business model.',
};

// Multi-unit development plan
const MULTI_UNIT_DEVELOPMENT_PLAN: PlatformQualificationCriterion = {
  criterionKey: 'multi_unit_development_plan',
  label: 'Multi-Unit Development Plan',
  description: 'Applicant has a credible plan for opening and operating multiple units within the agreed schedule.',
};

// Distribution
const DISTRIBUTION_INFRASTRUCTURE: PlatformQualificationCriterion = {
  criterionKey: 'distribution_infrastructure',
  label: 'Distribution Infrastructure',
  description: 'Applicant has or has plans for warehouse, logistics, and cold-chain infrastructure appropriate for the product.',
};
const TRADE_REFERENCES: PlatformQualificationCriterion = {
  criterionKey: 'trade_references',
  label: 'Trade References',
  description: 'Applicant can provide verifiable references from suppliers or buyers in the relevant trade.',
};
const GEOGRAPHIC_COVERAGE: PlatformQualificationCriterion = {
  criterionKey: 'geographic_coverage',
  label: 'Geographic Coverage',
  description: 'Applicant can service the defined geographic territory.',
};
const FINANCIAL_STANDING: PlatformQualificationCriterion = {
  criterionKey: 'financial_standing',
  label: 'Financial Standing',
  description: 'Applicant\'s credit and payment history meets the minimum financial standing for appointment.',
};
const EXCLUSIVITY_TERRITORY_CAPACITY: PlatformQualificationCriterion = {
  criterionKey: 'exclusivity_territory_capacity',
  label: 'Exclusivity Territory Capacity',
  description: 'Applicant has the capacity to exclusively develop and defend the assigned exclusive territory.',
};
const SUB_DISTRIBUTOR_MANAGEMENT: PlatformQualificationCriterion = {
  criterionKey: 'sub_distributor_management',
  label: 'Sub-Distributor Management',
  description: 'Applicant has the organizational capacity to appoint, train, and manage sub-distributors.',
};

// Affiliate
const AUDIENCE_REACH: PlatformQualificationCriterion = {
  criterionKey: 'audience_reach',
  label: 'Audience Reach',
  description: 'Applicant has an audience or following relevant to the brand\'s target market.',
};
const CONTENT_QUALITY: PlatformQualificationCriterion = {
  criterionKey: 'content_quality',
  label: 'Content Quality',
  description: 'Applicant produces content aligned with the brand\'s quality and safety standards.',
};
const BRAND_ALIGNMENT: PlatformQualificationCriterion = {
  criterionKey: 'brand_alignment',
  label: 'Brand Alignment',
  description: 'Applicant\'s brand positioning and values are consistent with the franchisor\'s brand.',
};
const TRAFFIC_ANALYTICS: PlatformQualificationCriterion = {
  criterionKey: 'traffic_analytics',
  label: 'Traffic Analytics',
  description: 'Applicant can provide verifiable reach and engagement analytics (platform-derived or submitted).',
};

// License
const USE_CASE_ALIGNMENT: PlatformQualificationCriterion = {
  criterionKey: 'use_case_alignment',
  label: 'Use Case Alignment',
  description: 'Applicant\'s intended use of the license aligns with the permitted use terms.',
};
const TECHNICAL_CAPABILITY: PlatformQualificationCriterion = {
  criterionKey: 'technical_capability',
  label: 'Technical Capability',
  description: 'Applicant has the technical capability to implement and operate the licensed IP.',
};
const COMPLIANCE_CAPABILITY: PlatformQualificationCriterion = {
  criterionKey: 'compliance_capability',
  label: 'Compliance Capability',
  description: 'Applicant can meet all regulatory and contractual compliance requirements of the license.',
};

// Agent
const TERRITORY_COVERAGE: PlatformQualificationCriterion = {
  criterionKey: 'territory_coverage',
  label: 'Territory Coverage',
  description: 'Applicant can actively cover the assigned sales territory.',
};
const SALES_TRACK_RECORD: PlatformQualificationCriterion = {
  criterionKey: 'sales_track_record',
  label: 'Sales Track Record',
  description: 'Applicant has a demonstrable track record in sales in the relevant sector.',
};
const TRAINING_COMPLETION: PlatformQualificationCriterion = {
  criterionKey: 'training_completion',
  label: 'Platform Training Completion',
  description: 'Applicant has completed the required platform onboarding and compliance training.',
};

// ── Platform qualification profiles ──────────────────────────────────────────

const PLATFORM_QUALIFICATION_PROFILES: readonly PlatformQualificationProfile[] = [
  {
    profileKey: 'qualification:franchise:unit:v1',
    criteria: [
      INVESTMENT_CAPACITY,
      LIQUID_CAPITAL,
      NET_WORTH,
      OPERATIONAL_COMMITMENT,
      PRIOR_BUSINESS_EXPERIENCE,
    ],
  },
  {
    profileKey: 'qualification:franchise:multi-unit:v1',
    criteria: [
      INVESTMENT_CAPACITY,
      LIQUID_CAPITAL,
      NET_WORTH,
      OPERATIONAL_COMMITMENT,
      PRIOR_BUSINESS_EXPERIENCE,
      MULTI_UNIT_DEVELOPMENT_PLAN,
    ],
  },
  {
    profileKey: 'qualification:franchise:area-development:v1',
    criteria: [
      INVESTMENT_CAPACITY,
      LIQUID_CAPITAL,
      NET_WORTH,
      OPERATIONAL_COMMITMENT,
      PRIOR_BUSINESS_EXPERIENCE,
      AREA_DEVELOPMENT_CAPITAL,
      MANAGEMENT_TEAM,
    ],
  },
  {
    profileKey: 'qualification:franchise:conversion:v1',
    criteria: [
      INVESTMENT_CAPACITY,
      LIQUID_CAPITAL,
      NET_WORTH,
      OPERATIONAL_COMMITMENT,
      EXISTING_BUSINESS_COMPATIBILITY,
    ],
  },
  {
    profileKey: 'qualification:franchise:master:v1',
    criteria: [
      INVESTMENT_CAPACITY,
      LIQUID_CAPITAL,
      NET_WORTH,
      MULTI_UNIT_EXPERIENCE,
      TERRITORY_MANAGEMENT_CAPACITY,
      LEGAL_ENTITY_SUITABILITY,
    ],
  },
  {
    profileKey: 'qualification:distribution:exclusive:v1',
    criteria: [
      DISTRIBUTION_INFRASTRUCTURE,
      TRADE_REFERENCES,
      GEOGRAPHIC_COVERAGE,
      FINANCIAL_STANDING,
      EXCLUSIVITY_TERRITORY_CAPACITY,
    ],
  },
  {
    profileKey: 'qualification:distribution:standard:v1',
    criteria: [
      DISTRIBUTION_INFRASTRUCTURE,
      TRADE_REFERENCES,
      GEOGRAPHIC_COVERAGE,
      FINANCIAL_STANDING,
    ],
  },
  {
    profileKey: 'qualification:distribution:master:v1',
    criteria: [
      DISTRIBUTION_INFRASTRUCTURE,
      TRADE_REFERENCES,
      GEOGRAPHIC_COVERAGE,
      FINANCIAL_STANDING,
      SUB_DISTRIBUTOR_MANAGEMENT,
    ],
  },
  {
    profileKey: 'qualification:affiliate:standard:v1',
    criteria: [
      AUDIENCE_REACH,
      CONTENT_QUALITY,
      BRAND_ALIGNMENT,
      TRAFFIC_ANALYTICS,
    ],
  },
  {
    profileKey: 'qualification:license:standard:v1',
    criteria: [
      USE_CASE_ALIGNMENT,
      TECHNICAL_CAPABILITY,
      COMPLIANCE_CAPABILITY,
    ],
  },
  {
    profileKey: 'qualification:agent:standard:v1',
    criteria: [
      TERRITORY_COVERAGE,
      SALES_TRACK_RECORD,
      TRAINING_COMPLETION,
    ],
  },
];

// ── Evidence requirement helpers ──────────────────────────────────────────────

function req(
  criterionKey: string,
  minimumProvenanceLevel: QualificationEvidenceSource,
  mode: EvidenceProfileRequirement['mode'],
  blocksVerifiedScore: boolean,
): EvidenceProfileRequirement {
  return { criterionKey, minimumProvenanceLevel, mode, blocksVerifiedScore };
}

// ── Platform evidence profiles ────────────────────────────────────────────────

export interface PlatformEvidenceProfile {
  readonly profileKey: string;
  readonly requirements: readonly EvidenceProfileRequirement[];
}

const PLATFORM_EVIDENCE_PROFILES: readonly PlatformEvidenceProfile[] = [
  // Franchise — Single Unit and Resale share the qualification profile;
  // Resale raises the bar for prior_business_experience (must be verified).
  {
    profileKey: 'evidence:franchise:unit:v1',
    requirements: [
      req('investment_capacity', 'DOCUMENT_VERIFIED', 'REQUIRED', true),
      req('liquid_capital',      'DOCUMENT_VERIFIED', 'REQUIRED', true),
      req('net_worth',           'OPERATOR_ASSESSED', 'REQUIRED', true),
      req('operational_commitment', 'SELF_DECLARED',  'REQUIRED', false),
      req('prior_business_experience', 'SELF_DECLARED', 'OPTIONAL', false),
    ],
  },
  {
    profileKey: 'evidence:franchise:resale:v1',
    requirements: [
      req('investment_capacity', 'DOCUMENT_VERIFIED', 'REQUIRED', true),
      req('liquid_capital',      'DOCUMENT_VERIFIED', 'REQUIRED', true),
      req('net_worth',           'OPERATOR_ASSESSED', 'REQUIRED', true),
      req('operational_commitment', 'SELF_DECLARED',  'REQUIRED', false),
      // Resale buyers must demonstrate prior experience at operator level.
      req('prior_business_experience', 'OPERATOR_ASSESSED', 'REQUIRED', true),
    ],
  },
  {
    profileKey: 'evidence:franchise:multi-unit:v1',
    requirements: [
      req('investment_capacity', 'DOCUMENT_VERIFIED', 'REQUIRED', true),
      req('liquid_capital',      'DOCUMENT_VERIFIED', 'REQUIRED', true),
      req('net_worth',           'OPERATOR_ASSESSED', 'REQUIRED', true),
      req('operational_commitment', 'SELF_DECLARED',  'REQUIRED', false),
      req('prior_business_experience', 'SELF_DECLARED', 'OPTIONAL', false),
      req('multi_unit_development_plan', 'OPERATOR_ASSESSED', 'REQUIRED', true),
    ],
  },
  {
    profileKey: 'evidence:franchise:area-development:v1',
    requirements: [
      req('investment_capacity',   'DOCUMENT_VERIFIED', 'REQUIRED', true),
      req('liquid_capital',        'EXTERNAL_VERIFIED', 'REQUIRED', true),
      req('net_worth',             'DOCUMENT_VERIFIED', 'REQUIRED', true),
      req('operational_commitment','SELF_DECLARED',     'REQUIRED', false),
      req('area_development_capital', 'DOCUMENT_VERIFIED', 'REQUIRED', true),
      req('management_team',       'OPERATOR_ASSESSED', 'REQUIRED', true),
    ],
  },
  {
    profileKey: 'evidence:franchise:conversion:v1',
    requirements: [
      req('investment_capacity',  'DOCUMENT_VERIFIED', 'REQUIRED', true),
      req('liquid_capital',       'DOCUMENT_VERIFIED', 'REQUIRED', true),
      req('net_worth',            'OPERATOR_ASSESSED', 'REQUIRED', true),
      req('operational_commitment','SELF_DECLARED',    'REQUIRED', false),
      req('existing_business_compatibility', 'OPERATOR_ASSESSED', 'REQUIRED', true),
    ],
  },
  {
    profileKey: 'evidence:franchise:master:v1',
    requirements: [
      req('investment_capacity',        'EXTERNAL_VERIFIED', 'REQUIRED', true),
      req('liquid_capital',             'EXTERNAL_VERIFIED', 'REQUIRED', true),
      req('net_worth',                  'DOCUMENT_VERIFIED', 'REQUIRED', true),
      req('multi_unit_experience',      'DOCUMENT_VERIFIED', 'REQUIRED', true),
      req('territory_management_capacity', 'OPERATOR_ASSESSED', 'REQUIRED', true),
      req('legal_entity_suitability',   'DOCUMENT_VERIFIED', 'REQUIRED', true),
    ],
  },
  {
    profileKey: 'evidence:distribution:standard:v1',
    requirements: [
      req('distribution_infrastructure', 'OPERATOR_ASSESSED', 'REQUIRED', true),
      req('trade_references',            'DOCUMENT_VERIFIED', 'REQUIRED', true),
      req('geographic_coverage',         'SELF_DECLARED',     'REQUIRED', false),
      req('financial_standing',          'DOCUMENT_VERIFIED', 'REQUIRED', true),
    ],
  },
  {
    profileKey: 'evidence:distribution:master:v1',
    requirements: [
      req('distribution_infrastructure', 'OPERATOR_ASSESSED', 'REQUIRED', true),
      req('trade_references',            'DOCUMENT_VERIFIED', 'REQUIRED', true),
      req('geographic_coverage',         'SELF_DECLARED',     'REQUIRED', false),
      req('financial_standing',          'DOCUMENT_VERIFIED', 'REQUIRED', true),
      req('sub_distributor_management',  'OPERATOR_ASSESSED', 'REQUIRED', true),
    ],
  },
  {
    profileKey: 'evidence:affiliate:standard:v1',
    requirements: [
      req('audience_reach',    'SELF_DECLARED',    'REQUIRED',  false),
      req('content_quality',   'OPERATOR_ASSESSED','OPTIONAL',  false),
      req('brand_alignment',   'OPERATOR_ASSESSED','REQUIRED',  false),
      req('traffic_analytics', 'SYSTEM_DERIVED',   'OPTIONAL',  false),
    ],
  },
  {
    profileKey: 'evidence:license:standard:v1',
    requirements: [
      req('use_case_alignment',   'OPERATOR_ASSESSED', 'REQUIRED', true),
      req('technical_capability', 'SELF_DECLARED',     'REQUIRED', false),
      req('compliance_capability','OPERATOR_ASSESSED', 'REQUIRED', true),
    ],
  },
  {
    profileKey: 'evidence:agent:standard:v1',
    requirements: [
      req('territory_coverage',  'SELF_DECLARED',    'REQUIRED', false),
      req('sales_track_record',  'OPERATOR_ASSESSED','OPTIONAL', false),
      // SYSTEM_DERIVED: platform sets training_completion when the agent
      // completes the training module; it cannot be self-declared.
      req('training_completion', 'SYSTEM_DERIVED',   'REQUIRED', true),
    ],
  },
];

// ── Indexes ───────────────────────────────────────────────────────────────────

const QUALIFICATION_PROFILE_INDEX = new Map<string, PlatformQualificationProfile>(
  PLATFORM_QUALIFICATION_PROFILES.map((p) => [p.profileKey, p]),
);

const EVIDENCE_PROFILE_INDEX = new Map<string, PlatformEvidenceProfile>(
  PLATFORM_EVIDENCE_PROFILES.map((p) => [p.profileKey, p]),
);

// ── Resolvers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the Platform-default qualification criteria for a given
 * qualificationProfileKey. Returns undefined if the key is not in the pack
 * (which signals a gap between the registry and the pack).
 */
export function resolvePlatformQualificationCriteria(
  qualificationProfileKey: string,
): PlatformQualificationProfile | undefined {
  return QUALIFICATION_PROFILE_INDEX.get(qualificationProfileKey);
}

/**
 * Resolve the Platform-default evidence requirements for a given
 * evidenceProfileKey. Returns undefined if the key is not in the pack.
 */
export function resolvePlatformEvidenceRequirements(
  evidenceProfileKey: string,
): PlatformEvidenceProfile | undefined {
  return EVIDENCE_PROFILE_INDEX.get(evidenceProfileKey);
}

/** All Platform qualification profiles — used by the Brand configuration
 *  workspace to render the platform defaults for each interest type. */
export function listPlatformQualificationProfiles(): readonly PlatformQualificationProfile[] {
  return PLATFORM_QUALIFICATION_PROFILES;
}

/** All Platform evidence profiles — used by the Brand configuration
 *  workspace to render the evidence requirements for each interest type. */
export function listPlatformEvidenceProfiles(): readonly PlatformEvidenceProfile[] {
  return PLATFORM_EVIDENCE_PROFILES;
}
