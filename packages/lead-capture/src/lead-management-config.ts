/**
 * LeadManagementConfiguration — the governed control-plane aggregate for
 * commercial opportunity lead capture.
 *
 * ADR-017 invariants enforced here:
 *   Invariant 1: schemaKey is LOCKED to the InterestTypeRegistry value.
 *     Other behavioral keys may be overridden only within declared bounds.
 *   Invariant 2: configurations requiring explicit parent approval never become
 *     effective through inaction. SLA timeout escalates; it does not approve.
 *
 * This module is pure and runtime-agnostic: no database, no network.
 */

import type {
  InterestTypeRegistryEntry,
  PublicationMode,
  RegistryInterestType,
  RegistryOpportunityType,
} from './interest-type-registry.ts';

// ── Governed lifecycle status ─────────────────────────────────────────────────

export type LeadManagementConfigStatus =
  | 'DRAFT'
  | 'PENDING_PARENT_REVIEW'
  | 'ESCALATED'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'SUPERSEDED'
  | 'EXPIRED_UNRESOLVED';

// ── Change classification ─────────────────────────────────────────────────────

/** ADR-017 override type catalog. Drives which approval gate a change enters. */
export type LeadManagementChangeType =
  | 'OPERATIONAL_ROUTING_SLA'
  | 'FORM_LABELS_ORDERING'
  | 'OPTIONAL_FIELD_ADDITION'
  | 'QUALIFICATION_THRESHOLD_TIGHTENING'
  | 'MANDATORY_FIELD_ADDITION'
  | 'COMPLIANCE_EVIDENCE_REQUIREMENT'
  | 'INTEREST_TYPE_ACTIVATION'
  | 'MANDATORY_PLATFORM_FIELD_REMOVAL';

export type ApprovalRequirement =
  | 'SELF_PUBLISHES'            // no review; config proceeds directly to APPROVED
  | 'PARENT_NOTIFICATION'       // parent notified; config proceeds to APPROVED after notification
  | 'EXPLICIT_PARENT_APPROVAL'  // waits for explicit ancestor approval; SLA timeout → ESCALATED
  | 'PLATFORM_AUDIT_REQUIRED'   // explicit parent + Platform audit; most restrictive
  | 'NOT_PERMITTED';            // blocked at any organizational level

// ── Key override modes ────────────────────────────────────────────────────────

export type KeyOverrideMode = 'LOCKED' | 'BOUNDED_SAME_DOMAIN' | 'OVERRIDABLE';

export const KEY_OVERRIDE_MODES = {
  schemaKey: 'LOCKED',
  qualificationProfileKey: 'BOUNDED_SAME_DOMAIN',
  workflowBlueprintKey: 'BOUNDED_SAME_DOMAIN',
  evidenceProfileKey: 'BOUNDED_SAME_DOMAIN',
  defaultRoutingProfileKey: 'OVERRIDABLE',
} as const satisfies Record<string, KeyOverrideMode>;

// ── Configuration aggregate ───────────────────────────────────────────────────

export interface LeadManagementFormCustomization {
  readonly labelOverrides: Readonly<Record<string, string>>;
  readonly helpTextOverrides: Readonly<Record<string, string>>;
  readonly fieldOrdering: readonly string[];
}

export interface LeadManagementConfiguration {
  readonly configId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  /** null when this is the root configuration (Brand HQ level). */
  readonly parentConfigId: string | null;

  readonly interestType: RegistryInterestType;
  readonly opportunityType: RegistryOpportunityType | null;

  /** LOCKED: always the value from InterestTypeRegistry. Never overridden. */
  readonly schemaKey: string;
  /** BOUNDED_SAME_DOMAIN: child may change within the same key domain. */
  readonly qualificationProfileKey: string;
  /** BOUNDED_SAME_DOMAIN: child may change within the same key domain. */
  readonly workflowBlueprintKey: string;
  /** BOUNDED_SAME_DOMAIN: child may change within the same key domain. */
  readonly evidenceProfileKey: string;
  /** OVERRIDABLE: child may replace with any valid routing profile key. */
  readonly defaultRoutingProfileKey: string;

  /** Child may only narrow (restrict) the parent's set; never expand it. */
  readonly supportedPublicationModes: readonly PublicationMode[];

  /** 1–30 business days. Brand HQ sets the default; children may shorten only. */
  readonly reviewSlaBusinessDays: number;

  readonly formCustomizations: LeadManagementFormCustomization | null;

  readonly status: LeadManagementConfigStatus;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
  readonly submittedForReviewAt: string | null;
  /** When this config version expires if no ancestor acts (PENDING or ESCALATED). */
  readonly expiresAt: string | null;
}

/** The resolved configuration that a capture source actually operates under. */
export interface EffectiveLeadManagementConfig {
  readonly interestType: RegistryInterestType;
  readonly opportunityType: RegistryOpportunityType | null;
  readonly schemaKey: string;
  readonly qualificationProfileKey: string;
  readonly workflowBlueprintKey: string;
  readonly evidenceProfileKey: string;
  readonly defaultRoutingProfileKey: string;
  readonly supportedPublicationModes: readonly PublicationMode[];
  readonly reviewSlaBusinessDays: number;
  /** configIds from root (Brand HQ) to the deepest PUBLISHED config that contributed. */
  readonly inheritanceChain: readonly string[];
  readonly effectiveAt: string;
}

// ── Approval requirement lookup ───────────────────────────────────────────────

const APPROVAL_REQUIREMENTS: Readonly<Record<LeadManagementChangeType, ApprovalRequirement>> = {
  OPERATIONAL_ROUTING_SLA: 'PARENT_NOTIFICATION',
  FORM_LABELS_ORDERING: 'PARENT_NOTIFICATION',
  OPTIONAL_FIELD_ADDITION: 'SELF_PUBLISHES',
  QUALIFICATION_THRESHOLD_TIGHTENING: 'PARENT_NOTIFICATION',
  MANDATORY_FIELD_ADDITION: 'EXPLICIT_PARENT_APPROVAL',
  COMPLIANCE_EVIDENCE_REQUIREMENT: 'PLATFORM_AUDIT_REQUIRED',
  INTEREST_TYPE_ACTIVATION: 'EXPLICIT_PARENT_APPROVAL',
  MANDATORY_PLATFORM_FIELD_REMOVAL: 'NOT_PERMITTED',
};

export function approvalRequirementForChangeType(changeType: LeadManagementChangeType): ApprovalRequirement {
  return APPROVAL_REQUIREMENTS[changeType];
}

/** The highest approval requirement in a set of concurrent changes. */
export function maxApprovalRequirement(requirements: readonly ApprovalRequirement[]): ApprovalRequirement {
  const ORDER: Record<ApprovalRequirement, number> = {
    SELF_PUBLISHES: 0,
    PARENT_NOTIFICATION: 1,
    EXPLICIT_PARENT_APPROVAL: 2,
    PLATFORM_AUDIT_REQUIRED: 3,
    NOT_PERMITTED: 4,
  };
  return requirements.reduce<ApprovalRequirement>(
    (max, req) => (ORDER[req] > ORDER[max] ? req : max),
    'SELF_PUBLISHES',
  );
}

// ── State machine ─────────────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Readonly<Record<LeadManagementConfigStatus, readonly LeadManagementConfigStatus[]>> = {
  DRAFT: ['PENDING_PARENT_REVIEW', 'APPROVED'],
  PENDING_PARENT_REVIEW: ['APPROVED', 'ESCALATED', 'DRAFT'],
  ESCALATED: ['APPROVED', 'EXPIRED_UNRESOLVED'],
  APPROVED: ['PUBLISHED'],
  PUBLISHED: ['SUPERSEDED'],
  SUPERSEDED: [],
  EXPIRED_UNRESOLVED: ['DRAFT'],
};

/**
 * Transitions that an authorized ancestor must explicitly trigger.
 * ADR-017 Invariant 2: these never fire automatically on timeout.
 * Timeout fires PENDING_PARENT_REVIEW → ESCALATED (a system action, not ancestor action).
 */
const ANCESTOR_ACTION_REQUIRED: ReadonlySet<string> = new Set([
  'PENDING_PARENT_REVIEW:APPROVED',
  'PENDING_PARENT_REVIEW:DRAFT',
  'ESCALATED:APPROVED',
]);

export interface ConfigTransitionResult {
  readonly allowed: boolean;
  readonly requiresAncestorAction: boolean;
  readonly reason?: string;
}

export function classifyConfigTransition(
  from: LeadManagementConfigStatus,
  to: LeadManagementConfigStatus,
): ConfigTransitionResult {
  if (from === to) {
    return { allowed: false, requiresAncestorAction: false, reason: 'ALREADY_IN_STATE' };
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    return { allowed: false, requiresAncestorAction: false, reason: 'TRANSITION_NOT_PERMITTED' };
  }
  const pair = `${from}:${to}`;
  return { allowed: true, requiresAncestorAction: ANCESTOR_ACTION_REQUIRED.has(pair) };
}

// ── Key override validation ───────────────────────────────────────────────────

export interface KeyOverrideValidation {
  readonly valid: boolean;
  readonly reason?: string;
}

function keyDomain(key: string): string {
  const parts = key.split(':');
  return `${parts[0] ?? ''}:${parts[1] ?? ''}`;
}

export function validateKeyOverride(
  parentKey: string,
  childKey: string,
  mode: KeyOverrideMode,
): KeyOverrideValidation {
  if (parentKey === childKey) return { valid: true };
  if (mode === 'LOCKED') return { valid: false, reason: 'KEY_OVERRIDE_LOCKED' };
  if (mode === 'BOUNDED_SAME_DOMAIN' && keyDomain(parentKey) !== keyDomain(childKey)) {
    return { valid: false, reason: 'KEY_OVERRIDE_DOMAIN_MISMATCH' };
  }
  return { valid: true };
}

// ── Publication mode restriction ──────────────────────────────────────────────

export interface PublicationModeRestrictionResult {
  readonly valid: boolean;
  readonly effectiveModes: readonly PublicationMode[];
  readonly reason?: string;
}

/** Apply a child restriction to the parent's publication mode set.
 *  Child may only narrow (remove modes); it cannot add modes the parent lacks. */
export function applyPublicationModeRestriction(
  parentModes: readonly PublicationMode[],
  childModes: readonly PublicationMode[],
): PublicationModeRestrictionResult {
  if (childModes.length === 0) {
    return { valid: false, effectiveModes: parentModes, reason: 'PUBLICATION_MODES_CANNOT_BE_EMPTY' };
  }
  const parentSet = new Set<string>(parentModes);
  const disallowed = childModes.filter((m) => !parentSet.has(m));
  if (disallowed.length > 0) {
    return {
      valid: false,
      effectiveModes: parentModes,
      reason: `PUBLICATION_MODE_EXPANSION_NOT_PERMITTED`,
    };
  }
  return { valid: true, effectiveModes: childModes };
}

// ── Root config builder ───────────────────────────────────────────────────────

export interface RootConfigOptions {
  readonly configId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  /** Default 5. Must be 1–30. */
  readonly reviewSlaBusinessDays?: number;
  readonly createdAt: string;
}

/** Build the initial root configuration from an InterestTypeRegistry entry.
 *  This is the Brand HQ level config — parentConfigId is null. */
export function buildRootConfig(
  entry: InterestTypeRegistryEntry,
  options: RootConfigOptions,
): LeadManagementConfiguration {
  const sla = options.reviewSlaBusinessDays ?? 5;
  if (!Number.isInteger(sla) || sla < 1 || sla > 30) {
    throw new Error('REVIEW_SLA_OUT_OF_BOUNDS');
  }
  return {
    configId: options.configId,
    tenantId: options.tenantId,
    organizationId: options.organizationId,
    parentConfigId: null,
    interestType: entry.interestType,
    opportunityType: entry.opportunityType ?? null,
    schemaKey: entry.schemaKey,
    qualificationProfileKey: entry.qualificationProfileKey,
    workflowBlueprintKey: entry.workflowBlueprintKey,
    evidenceProfileKey: entry.evidenceProfileKey,
    defaultRoutingProfileKey: entry.defaultRoutingProfileKey,
    supportedPublicationModes: entry.supportedPublicationModes,
    reviewSlaBusinessDays: sla,
    formCustomizations: null,
    status: 'DRAFT',
    version: 1,
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
    publishedAt: null,
    submittedForReviewAt: null,
    expiresAt: null,
  };
}

// ── Effective config resolution ───────────────────────────────────────────────

export type EffectiveConfigResolutionResult =
  | { readonly status: 'RESOLVED'; readonly config: EffectiveLeadManagementConfig }
  | { readonly status: 'UNRESOLVED'; readonly reason: string };

/** Resolve the effective configuration for a chain of configs ordered from root
 *  (Brand HQ) to leaf (the deepest child organization). Only PUBLISHED configs
 *  with a publishedAt at or before effectiveAt contribute. Overrides that
 *  violate bounds are silently rejected (fail-closed: parent value holds). */
export function resolveEffectiveConfig(
  chain: readonly LeadManagementConfiguration[],
  effectiveAt: string,
): EffectiveConfigResolutionResult {
  const published = chain.filter(
    (c) =>
      c.status === 'PUBLISHED' &&
      (c.publishedAt == null || c.publishedAt <= effectiveAt),
  );

  if (published.length === 0) {
    return { status: 'UNRESOLVED', reason: 'NO_PUBLISHED_CONFIG_IN_CHAIN' };
  }

  const root = published[0]!;
  let effective: EffectiveLeadManagementConfig = {
    interestType: root.interestType,
    opportunityType: root.opportunityType,
    schemaKey: root.schemaKey,
    qualificationProfileKey: root.qualificationProfileKey,
    workflowBlueprintKey: root.workflowBlueprintKey,
    evidenceProfileKey: root.evidenceProfileKey,
    defaultRoutingProfileKey: root.defaultRoutingProfileKey,
    supportedPublicationModes: root.supportedPublicationModes,
    reviewSlaBusinessDays: root.reviewSlaBusinessDays,
    inheritanceChain: [root.configId],
    effectiveAt,
  };

  for (const config of published.slice(1)) {
    const qualValid = validateKeyOverride(
      effective.qualificationProfileKey,
      config.qualificationProfileKey,
      'BOUNDED_SAME_DOMAIN',
    );
    const wfValid = validateKeyOverride(
      effective.workflowBlueprintKey,
      config.workflowBlueprintKey,
      'BOUNDED_SAME_DOMAIN',
    );
    const evValid = validateKeyOverride(
      effective.evidenceProfileKey,
      config.evidenceProfileKey,
      'BOUNDED_SAME_DOMAIN',
    );
    const modeResult = applyPublicationModeRestriction(
      effective.supportedPublicationModes,
      config.supportedPublicationModes,
    );

    effective = {
      ...effective,
      qualificationProfileKey: qualValid.valid
        ? config.qualificationProfileKey
        : effective.qualificationProfileKey,
      workflowBlueprintKey: wfValid.valid
        ? config.workflowBlueprintKey
        : effective.workflowBlueprintKey,
      evidenceProfileKey: evValid.valid
        ? config.evidenceProfileKey
        : effective.evidenceProfileKey,
      defaultRoutingProfileKey: config.defaultRoutingProfileKey,
      supportedPublicationModes: modeResult.valid
        ? modeResult.effectiveModes
        : effective.supportedPublicationModes,
      reviewSlaBusinessDays: config.reviewSlaBusinessDays,
      inheritanceChain: [...effective.inheritanceChain, config.configId],
    };
  }

  return { status: 'RESOLVED', config: effective };
}
