/**
 * InterestTypeRegistry — the authoritative resolver from a commercial interest
 * type + opportunity type to the governed configuration keys that drive all
 * downstream behavior.
 *
 * ADR-017 invariant 1: no business behavior is inferred from a free-form key.
 * Every behavioral resolution flows through this registry.
 *
 * The registry is a pure, versioned constant — no database, no network. It is
 * the single source of truth for:
 *   schemaKey             → which capture schema applies
 *   qualificationProfileKey → which scoring/qualification template applies
 *   workflowBlueprintKey  → which workflow lifecycle applies
 *   evidenceProfileKey    → which evidence/compliance requirements apply
 *   defaultRoutingProfileKey → default routing policy for unassigned leads
 *   supportedPublicationModes → which publication channels are permitted
 *
 * Keys follow the pattern  domain:sub-domain:variant:version
 * e.g.  opportunity:franchise:single-unit:v1
 *
 * When a LeadManagementConfiguration overrides a key (within permitted bounds),
 * it supplies a replacement key that resolves through the same contract — it
 * does NOT supply inline configuration.
 */

// These mirror CaptureInterestType and the opportunity-type unions from
// interest-payload.ts (introduced in PR #670). Kept local here so the registry
// can be imported without pulling in the full interest-payload module, and so
// it compiles on branches where PR #670 is not yet merged.
export type RegistryInterestType =
  | 'FRANCHISEE'
  | 'MASTER_FRANCHISEE'
  | 'DISTRIBUTOR'
  | 'AFFILIATE'
  | 'LICENSEE'
  | 'AGENT';

export type FranchiseeOpportunityType =
  | 'SINGLE_UNIT'
  | 'MULTI_UNIT'
  | 'AREA_DEVELOPMENT'
  | 'CONVERSION'
  | 'RESALE';

export type DistributorOpportunityType =
  | 'EXCLUSIVE_DISTRIBUTOR'
  | 'NON_EXCLUSIVE_DISTRIBUTOR'
  | 'MASTER_DISTRIBUTOR'
  | 'SUB_DISTRIBUTOR';

export type RegistryOpportunityType = FranchiseeOpportunityType | DistributorOpportunityType;

export type PublicationMode =
  | 'HOSTED_FORM'
  | 'JS_WIDGET'
  | 'IFRAME'
  | 'REST_API'
  | 'SIGNED_WEBHOOK'
  | 'EMAIL_LINK'
  | 'SOCIAL_LINK'
  | 'WHATSAPP_SMS_LINK'
  | 'QR_CODE';

/** All publication modes. Used as the default for interest types that impose
 *  no restrictions on channel; individual entries may restrict the set. */
export const PUBLICATION_MODES: readonly PublicationMode[] = [
  'HOSTED_FORM',
  'JS_WIDGET',
  'IFRAME',
  'REST_API',
  'SIGNED_WEBHOOK',
  'EMAIL_LINK',
  'SOCIAL_LINK',
  'WHATSAPP_SMS_LINK',
  'QR_CODE',
];

export function isPublicationMode(value: unknown): value is PublicationMode {
  return typeof value === 'string' && PUBLICATION_MODES.includes(value as PublicationMode);
}

export interface InterestTypeRegistryEntry {
  readonly interestType: RegistryInterestType;
  /** Undefined for interest types that have no further sub-variant (AFFILIATE,
   *  LICENSEE, AGENT, MASTER_FRANCHISEE). Defined for FRANCHISEE and
   *  DISTRIBUTOR which have meaningful sub-types that affect schema and
   *  workflow. */
  readonly opportunityType?: RegistryOpportunityType;
  /** Human-readable label. Used by the Brand configuration workspace. */
  readonly label: string;
  readonly schemaKey: string;
  readonly qualificationProfileKey: string;
  readonly workflowBlueprintKey: string;
  readonly evidenceProfileKey: string;
  readonly defaultRoutingProfileKey: string;
  readonly supportedPublicationModes: readonly PublicationMode[];
}

/** Lookup key: `interestType:opportunityType` or just `interestType` when
 *  no opportunityType applies. */
export type InterestRegistryKey = string;

function key(interestType: RegistryInterestType, opportunityType?: RegistryOpportunityType): InterestRegistryKey {
  return opportunityType ? `${interestType}:${opportunityType}` : interestType;
}

const ENTRIES: readonly InterestTypeRegistryEntry[] = [
  // ── FRANCHISEE ──────────────────────────────────────────────────────────────
  {
    interestType: 'FRANCHISEE',
    opportunityType: 'SINGLE_UNIT',
    label: 'Franchise — Single Unit',
    schemaKey: 'opportunity:franchise:single-unit:v1',
    qualificationProfileKey: 'qualification:franchise:unit:v1',
    workflowBlueprintKey: 'workflow:franchise:unit:v1',
    evidenceProfileKey: 'evidence:franchise:unit:v1',
    defaultRoutingProfileKey: 'routing:franchise:territory:v1',
    supportedPublicationModes: PUBLICATION_MODES,
  },
  {
    interestType: 'FRANCHISEE',
    opportunityType: 'MULTI_UNIT',
    label: 'Franchise — Multi-Unit',
    schemaKey: 'opportunity:franchise:multi-unit:v1',
    qualificationProfileKey: 'qualification:franchise:multi-unit:v1',
    workflowBlueprintKey: 'workflow:franchise:multi-unit:v1',
    evidenceProfileKey: 'evidence:franchise:multi-unit:v1',
    defaultRoutingProfileKey: 'routing:franchise:territory:v1',
    supportedPublicationModes: PUBLICATION_MODES,
  },
  {
    interestType: 'FRANCHISEE',
    opportunityType: 'AREA_DEVELOPMENT',
    label: 'Franchise — Area Development',
    schemaKey: 'opportunity:franchise:area-development:v1',
    qualificationProfileKey: 'qualification:franchise:area-development:v1',
    workflowBlueprintKey: 'workflow:franchise:area-development:v1',
    evidenceProfileKey: 'evidence:franchise:area-development:v1',
    defaultRoutingProfileKey: 'routing:franchise:territory:v1',
    supportedPublicationModes: PUBLICATION_MODES,
  },
  {
    interestType: 'FRANCHISEE',
    opportunityType: 'CONVERSION',
    label: 'Franchise — Conversion',
    schemaKey: 'opportunity:franchise:conversion:v1',
    qualificationProfileKey: 'qualification:franchise:conversion:v1',
    workflowBlueprintKey: 'workflow:franchise:conversion:v1',
    evidenceProfileKey: 'evidence:franchise:conversion:v1',
    defaultRoutingProfileKey: 'routing:franchise:territory:v1',
    supportedPublicationModes: PUBLICATION_MODES,
  },
  {
    interestType: 'FRANCHISEE',
    opportunityType: 'RESALE',
    label: 'Franchise — Resale',
    schemaKey: 'opportunity:franchise:resale:v1',
    qualificationProfileKey: 'qualification:franchise:unit:v1',
    workflowBlueprintKey: 'workflow:franchise:resale:v1',
    evidenceProfileKey: 'evidence:franchise:resale:v1',
    defaultRoutingProfileKey: 'routing:franchise:territory:v1',
    supportedPublicationModes: PUBLICATION_MODES,
  },

  // ── MASTER FRANCHISEE ────────────────────────────────────────────────────────
  {
    interestType: 'MASTER_FRANCHISEE',
    label: 'Master Franchise',
    schemaKey: 'opportunity:franchise:master:v1',
    qualificationProfileKey: 'qualification:franchise:master:v1',
    workflowBlueprintKey: 'workflow:franchise:master:v1',
    evidenceProfileKey: 'evidence:franchise:master:v1',
    defaultRoutingProfileKey: 'routing:franchise:master:v1',
    supportedPublicationModes: ['HOSTED_FORM', 'REST_API', 'SIGNED_WEBHOOK', 'EMAIL_LINK'],
  },

  // ── DISTRIBUTOR ──────────────────────────────────────────────────────────────
  {
    interestType: 'DISTRIBUTOR',
    opportunityType: 'EXCLUSIVE_DISTRIBUTOR',
    label: 'Distribution — Exclusive',
    schemaKey: 'opportunity:distribution:exclusive:v1',
    qualificationProfileKey: 'qualification:distribution:exclusive:v1',
    workflowBlueprintKey: 'workflow:distribution:standard:v1',
    evidenceProfileKey: 'evidence:distribution:standard:v1',
    defaultRoutingProfileKey: 'routing:distribution:territory:v1',
    supportedPublicationModes: PUBLICATION_MODES,
  },
  {
    interestType: 'DISTRIBUTOR',
    opportunityType: 'NON_EXCLUSIVE_DISTRIBUTOR',
    label: 'Distribution — Non-Exclusive',
    schemaKey: 'opportunity:distribution:non-exclusive:v1',
    qualificationProfileKey: 'qualification:distribution:standard:v1',
    workflowBlueprintKey: 'workflow:distribution:standard:v1',
    evidenceProfileKey: 'evidence:distribution:standard:v1',
    defaultRoutingProfileKey: 'routing:distribution:territory:v1',
    supportedPublicationModes: PUBLICATION_MODES,
  },
  {
    interestType: 'DISTRIBUTOR',
    opportunityType: 'MASTER_DISTRIBUTOR',
    label: 'Distribution — Master Distributor',
    schemaKey: 'opportunity:distribution:master:v1',
    qualificationProfileKey: 'qualification:distribution:master:v1',
    workflowBlueprintKey: 'workflow:distribution:master:v1',
    evidenceProfileKey: 'evidence:distribution:master:v1',
    defaultRoutingProfileKey: 'routing:distribution:master:v1',
    supportedPublicationModes: ['HOSTED_FORM', 'REST_API', 'SIGNED_WEBHOOK', 'EMAIL_LINK'],
  },
  {
    interestType: 'DISTRIBUTOR',
    opportunityType: 'SUB_DISTRIBUTOR',
    label: 'Distribution — Sub-Distributor',
    schemaKey: 'opportunity:distribution:sub:v1',
    qualificationProfileKey: 'qualification:distribution:standard:v1',
    workflowBlueprintKey: 'workflow:distribution:standard:v1',
    evidenceProfileKey: 'evidence:distribution:standard:v1',
    defaultRoutingProfileKey: 'routing:distribution:territory:v1',
    supportedPublicationModes: PUBLICATION_MODES,
  },

  // ── AFFILIATE ────────────────────────────────────────────────────────────────
  {
    interestType: 'AFFILIATE',
    label: 'Affiliate Partner',
    schemaKey: 'opportunity:affiliate:standard:v1',
    qualificationProfileKey: 'qualification:affiliate:standard:v1',
    workflowBlueprintKey: 'workflow:affiliate:standard:v1',
    evidenceProfileKey: 'evidence:affiliate:standard:v1',
    defaultRoutingProfileKey: 'routing:affiliate:standard:v1',
    supportedPublicationModes: PUBLICATION_MODES,
  },

  // ── LICENSEE ─────────────────────────────────────────────────────────────────
  {
    interestType: 'LICENSEE',
    label: 'License',
    schemaKey: 'opportunity:license:standard:v1',
    qualificationProfileKey: 'qualification:license:standard:v1',
    workflowBlueprintKey: 'workflow:license:standard:v1',
    evidenceProfileKey: 'evidence:license:standard:v1',
    defaultRoutingProfileKey: 'routing:license:standard:v1',
    supportedPublicationModes: ['HOSTED_FORM', 'REST_API', 'SIGNED_WEBHOOK', 'EMAIL_LINK', 'SOCIAL_LINK'],
  },

  // ── AGENT ────────────────────────────────────────────────────────────────────
  {
    interestType: 'AGENT',
    label: 'Sales Agent',
    schemaKey: 'opportunity:agent:standard:v1',
    qualificationProfileKey: 'qualification:agent:standard:v1',
    workflowBlueprintKey: 'workflow:agent:standard:v1',
    evidenceProfileKey: 'evidence:agent:standard:v1',
    defaultRoutingProfileKey: 'routing:agent:standard:v1',
    supportedPublicationModes: PUBLICATION_MODES,
  },
];

/** Indexed by `interestType:opportunityType` or `interestType`. Built once. */
const REGISTRY_INDEX = new Map<InterestRegistryKey, InterestTypeRegistryEntry>(
  ENTRIES.map((e) => [key(e.interestType, e.opportunityType), e]),
);

/** Resolve an interest type + optional opportunity type to its registry entry.
 *  Returns undefined if the combination is not in the catalog. Callers must
 *  treat an undefined result as a contract violation — the combination is not
 *  a supported commercial interest type. */
export function resolveInterestType(
  interestType: RegistryInterestType,
  opportunityType?: RegistryOpportunityType,
): InterestTypeRegistryEntry | undefined {
  return REGISTRY_INDEX.get(key(interestType, opportunityType));
}

/** All entries in the registry, ordered as defined above. Used by the Brand
 *  configuration workspace to render the interest-type selector. */
export function listInterestTypes(): readonly InterestTypeRegistryEntry[] {
  return ENTRIES;
}

/** All entries for a given interest type. For FRANCHISEE and DISTRIBUTOR this
 *  returns the per-opportunity-type entries. For others it returns a single
 *  entry. Returns an empty array if the interest type is not in the catalog. */
export function listOpportunityTypes(interestType: RegistryInterestType): readonly InterestTypeRegistryEntry[] {
  return ENTRIES.filter((e) => e.interestType === interestType);
}

/** Whether a given publication mode is supported for this interest type +
 *  opportunity type combination. Returns false if the combination is not in
 *  the catalog. */
export function supportsPublicationMode(
  interestType: RegistryInterestType,
  opportunityType: RegistryOpportunityType | undefined,
  mode: PublicationMode,
): boolean {
  const entry = resolveInterestType(interestType, opportunityType);
  return entry?.supportedPublicationModes.includes(mode) ?? false;
}

/** All registry keys, for use in constraint validation and migrations. */
export const REGISTRY_SCHEMA_KEYS: readonly string[] = ENTRIES.map((e) => e.schemaKey);
export const REGISTRY_QUALIFICATION_PROFILE_KEYS: readonly string[] = [...new Set(ENTRIES.map((e) => e.qualificationProfileKey))];
export const REGISTRY_WORKFLOW_BLUEPRINT_KEYS: readonly string[] = [...new Set(ENTRIES.map((e) => e.workflowBlueprintKey))];
export const REGISTRY_EVIDENCE_PROFILE_KEYS: readonly string[] = [...new Set(ENTRIES.map((e) => e.evidenceProfileKey))];
export const REGISTRY_ROUTING_PROFILE_KEYS: readonly string[] = [...new Set(ENTRIES.map((e) => e.defaultRoutingProfileKey))];
