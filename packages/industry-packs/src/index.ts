/**
 * @expadio/industry-packs — verticals as data over the neutral engine.
 *
 * The universal business engine (@expadio/party|lead|case|agreement) is
 * industry-neutral. An Industry Pack is a *governed configuration artifact* —
 * an IndustryProfile plus a presentation-terminology catalogue — that reskins
 * the same engine for a vertical. It changes display text only: canonical
 * concept keys, authorization roles, persisted identities, and RLS are
 * untouched. That is the whole thesis, expressed as data: one engine, many
 * verticals, no forks.
 *
 * The CRM concept keys the packs relabel:
 *   crm.account   — a customer organization  (Party)
 *   crm.contact   — a person                 (Party)
 *   crm.lead      — a piece of pipeline       (Lead)
 *   crm.case      — a unit of work            (Case)
 *   crm.agreement — a signed commitment       (Agreement)
 */

import type {
  IndustryProfile,
  PresentationTerminologyCatalogue,
} from '@expadio/business-config';
import type { RelationshipDefinition } from '@expadio/relationship';
import type { GovernedActionRule } from '@expadio/governed-actions';

export const CRM_CONCEPTS = [
  'crm.account',
  'crm.contact',
  'crm.lead',
  'crm.case',
  'crm.agreement',
] as const;
export type CrmConcept = (typeof CRM_CONCEPTS)[number];

/** The five CRM concepts resolved to display text for a locale. */
export interface CrmVocabulary {
  readonly account: { singular: string; plural: string };
  readonly contact: { singular: string; plural: string };
  readonly lead: { singular: string; plural: string };
  readonly case: { singular: string; plural: string };
  readonly agreement: { singular: string; plural: string };
}

/** The neutral engine's own words — the fallback when no pack is active. */
export const NEUTRAL_CRM_VOCABULARY: CrmVocabulary = {
  account: { singular: 'Account', plural: 'Accounts' },
  contact: { singular: 'Contact', plural: 'Contacts' },
  lead: { singular: 'Lead', plural: 'Leads' },
  case: { singular: 'Case', plural: 'Cases' },
  agreement: { singular: 'Agreement', plural: 'Agreements' },
};

/**
 * The canonical stages of the crm.case ("unit of work") lifecycle — the neutral
 * engine's blueprint. A pack may relabel these to speak its vertical's process
 * language; the keys themselves (and the runtime that drives them) never change.
 */
export const CRM_CASE_STAGES = ['INTAKE', 'IN_PROGRESS', 'REVIEW', 'RESOLVED'] as const;
export type CrmCaseStage = (typeof CRM_CASE_STAGES)[number];

/** A pack's words for the crm.case process itself and each of its stages. */
export interface CaseWorkflowVocabulary {
  /** The process's own name — e.g. "Treatment" for a dental practice. */
  readonly workType: string;
  /** Display label per canonical stage key. */
  readonly stages: Record<CrmCaseStage, string>;
  /**
   * The pack's words for the blueprint's canonical decision outcomes, keyed by
   * the canonical outcome the runtime records (e.g. APPROVE, RETURN). A clinician
   * decides "Approve treatment plan"; the immutable decision still records the
   * canonical APPROVE, so the decision gate and the audit trail are unchanged —
   * this reskins the *decision experience*, not the governed outcome. An outcome
   * a pack does not relabel keeps its canonical key.
   */
  readonly decisionOutcomeLabels?: Readonly<Record<string, string>>;
  /**
   * A short domain note per canonical stage — what this stage governs in the
   * vertical's terms (DENTEX REVIEW: "A clinician signs off before discharge").
   * Guidance only: the canonical gates and runtime are untouched.
   */
  readonly stageGuidance?: Partial<Readonly<Record<CrmCaseStage, string>>>;
}

/** The neutral engine's own words for the case lifecycle — the fallback. */
export const NEUTRAL_CASE_WORKFLOW_VOCABULARY: CaseWorkflowVocabulary = {
  workType: 'Case',
  stages: { INTAKE: 'Intake', IN_PROGRESS: 'In progress', REVIEW: 'Review', RESOLVED: 'Resolved' },
  decisionOutcomeLabels: {},
  stageGuidance: {},
};

/**
 * A domain field a pack adds to the crm.case subject — the pack configuring
 * *data*, not just labels. Values are stored in the case's `attributes` JSONB
 * (canonical columns and the runtime are untouched); the field set is the pack's.
 */
export interface CaseField {
  /** Stored attribute key, e.g. 'tooth'. */
  readonly key: string;
  /** Display label, e.g. 'Tooth / quadrant'. */
  readonly label: string;
  readonly type: 'text' | 'number' | 'select';
  /** Allowed values for a select field. */
  readonly options?: readonly string[];
  readonly required?: boolean;
}

export interface CaseSchema {
  readonly fields: readonly CaseField[];
  /**
   * The schema's revision. Stamped onto each case's stored attributes so a
   * value bag is tied to the field set that validated it — the seam that lets a
   * pack evolve its fields (DENTEX v1 urgency options → v2) without silently
   * reinterpreting historical data. A pack's schema starts at 1; the neutral
   * engine has no schema and is version 0.
   */
  readonly version: number;
}

/** The neutral engine adds no domain fields — the fallback (version 0 = no schema). */
export const NEUTRAL_CASE_SCHEMA: CaseSchema = { fields: [], version: 0 };

/** The canonical CRM entities a case already links, that an ontology names. */
export const CASE_RELATIONSHIP_CONCEPTS = ['crm.account', 'crm.contact', 'crm.agreement'] as const;
export type CaseRelationshipConcept = (typeof CASE_RELATIONSHIP_CONCEPTS)[number];

/**
 * A vertical semantic gate attached to a canonical crm.case stage. Unlike
 * vocabulary, these requirements are intended to become executable policy:
 * the horizontal workflow runtime can evaluate them without knowing DENTEX,
 * LEXFLOW, or any other vertical by name.
 */
export interface CaseStageSemanticRequirement {
  readonly stageKey: CrmCaseStage;
  readonly phase: 'ENTRY' | 'EXIT';
  /** Pack-declared case attributes that must contain a non-empty value. */
  readonly requiredAttributeKeys?: readonly string[];
  /** Canonical CRM relationships that must exist for the case. */
  readonly requiredRelationships?: readonly CaseRelationshipConcept[];
  /** If supplied, the current stage must have one of these recorded outcomes. */
  readonly requiredDecisionOutcomes?: readonly string[];
  /** Domain-facing explanation surfaced when the semantic gate blocks. */
  readonly message: string;
}

export interface CaseWorkflowSemantics {
  readonly requirements: readonly CaseStageSemanticRequirement[];
}

export const NEUTRAL_CASE_WORKFLOW_SEMANTICS: CaseWorkflowSemantics = { requirements: [] };

/** One typed edge of a case's domain model — a canonical relation, in the pack's words. */
export interface CaseOntologyRelationship {
  /** The canonical CRM concept this edge points at. */
  readonly conceptKey: CaseRelationshipConcept;
  /** The pack's noun for the related entity (DENTEX contact → "Patient"). */
  readonly entityLabel: string;
  /** How the case relates to it (DENTEX contact → "Patient treated"). */
  readonly role: string;
}

/**
 * A case's domain model, made explicit: what a case *is* in the vertical's terms
 * (DENTEX: a "Treatment"), the typed relationships it has to the canonical CRM
 * entities it already links (account/contact/agreement, in the pack's words),
 * and the domain fields it carries. Composed from what a pack already declares —
 * an explicit ontology view, not a new store.
 */
export interface CaseOntology {
  readonly entity: string;
  readonly relationships: readonly CaseOntologyRelationship[];
  readonly fields: readonly CaseField[];
}

/** Default relationship roles when a pack does not name them. */
const NEUTRAL_CASE_RELATIONSHIP_ROLES: Readonly<Record<CaseRelationshipConcept, string>> = {
  'crm.account': 'Belongs to',
  'crm.contact': 'Concerns',
  'crm.agreement': 'Governed by',
};

export interface CaseLifecycleEventMapping {
  readonly stageKey: CrmCaseStage;
  readonly eventType: string;
  readonly eventVersion: number;
}

export interface IndustryPack {
  readonly verticalKey: string;
  readonly label: string;
  readonly profile: IndustryProfile;
  readonly terminology: PresentationTerminologyCatalogue;
  /**
   * Optional workflow-lifecycle vocabulary — display text for the crm.case
   * process and its stages. Display-only, like the entity terminology: the
   * canonical stage keys, the blueprint, and the runtime are untouched.
   */
  readonly caseWorkflow?: CaseWorkflowVocabulary;
  /**
   * Optional domain fields the pack adds to the crm.case subject — the pack
   * configuring data. Stored in the case's `attributes` JSONB; canonical columns,
   * authorization and RLS are untouched.
   */
  readonly caseSchema?: CaseSchema;
  /**
   * Optional per-relationship role names for the case's domain model — how the
   * case relates to each canonical CRM entity, in the pack's words (DENTEX
   * contact → "Patient treated"). Display-only: the canonical links are
   * unchanged; this names them. Unspecified relations fall back to neutral roles.
   */
  readonly caseOntologyRoles?: Partial<Readonly<Record<CaseRelationshipConcept, string>>>;
  /**
   * Optional executable domain semantics over the canonical case lifecycle.
   * The pack declares facts the horizontal workflow gate can enforce; the
   * Decision Fabric remains the only transition engine.
   */
  readonly caseStageSemantics?: CaseWorkflowSemantics;
  /**
   * Optional authoritative business-relationship definitions. These are
   * horizontal Relationship Fabric declarations, not workflow assignments.
   * A workflow may project one of these relationships into a participant slot,
   * but the relationship remains the source of truth.
   */
  readonly relationshipDefinitions?: readonly RelationshipDefinition[];
  /**
   * Optional semantic Domain Events emitted when a governed crm.case workflow
   * successfully lands on a canonical stage. The workflow engine remains
   * vertical-neutral; the application adapter resolves this Pack mapping after
   * the transition commits inside the caller's transaction.
   */
  readonly caseLifecycleEvents?: readonly CaseLifecycleEventMapping[];
  /**
   * Optional governed reactions to semantic Domain Events. Configuration may
   * contain safe runtime bindings; concrete recipient/context values are
   * materialized by the application from event + aggregate projections.
   */
  readonly governedActionRules?: readonly GovernedActionRule[];
}

// ---------------------------------------------------------------------------
// ACME Corp — a generic multi-service business.
// This pack proves the reskin is pure configuration: different words,
// different process language, different case data — all over the one neutral
// engine. Any brand/tenant that onboards to EXPADIO can author an equivalent
// pack for their own domain vocabulary.
// ---------------------------------------------------------------------------

const ACME_CORP_TERMINOLOGY: PresentationTerminologyCatalogue = {
  defaultLocale: 'en',
  concepts: [
    { conceptKey: 'crm.account', labels: [{ locale: 'en', singular: 'Client', plural: 'Clients' }] },
    { conceptKey: 'crm.contact', labels: [{ locale: 'en', singular: 'Contact', plural: 'Contacts' }] },
    { conceptKey: 'crm.lead', labels: [{ locale: 'en', singular: 'Enquiry', plural: 'Enquiries' }], aliases: ['enquiry'] },
    { conceptKey: 'crm.case', labels: [{ locale: 'en', singular: 'Service Request', plural: 'Service Requests' }] },
    { conceptKey: 'crm.agreement', labels: [{ locale: 'en', singular: 'Service Agreement', plural: 'Service Agreements' }] },
  ],
};

const ACME_CORP_PROFILE: IndustryProfile = {
  industryKey: 'acme-corp',
  label: 'ACME Corp — Multi-service business',
  components: [
    { kind: 'ONTOLOGY', key: 'acme-corp.crm', version: 1 },
    { kind: 'TERMINOLOGY', key: 'acme-corp.crm', version: 1 },
  ],
};

const ACME_CORP_CASE_WORKFLOW: CaseWorkflowVocabulary = {
  workType: 'Service Request',
  stages: {
    INTAKE: 'New Request',
    IN_PROGRESS: 'In Progress',
    REVIEW: 'Quality Review',
    RESOLVED: 'Completed',
  },
  decisionOutcomeLabels: {
    APPROVE: 'Approve & Close',
    RETURN: 'Return for Revision',
  },
  stageGuidance: {
    INTAKE: 'Capture the client request and agree scope.',
    IN_PROGRESS: 'Work the service request.',
    REVIEW: 'A senior team member reviews before closing.',
    RESOLVED: 'Request completed and archived.',
  },
};

const ACME_CORP_CASE_SCHEMA: CaseSchema = {
  version: 1,
  fields: [
    { key: 'serviceType', label: 'Service type', type: 'select', options: ['Consulting', 'Support', 'Installation', 'Training'], required: true },
    { key: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Normal', 'High', 'Critical'], required: true },
    { key: 'referenceCode', label: 'Reference code', type: 'text' },
  ],
};

const ACME_CORP_CASE_STAGE_SEMANTICS: CaseWorkflowSemantics = {
  requirements: [
    {
      stageKey: 'INTAKE',
      phase: 'EXIT',
      requiredRelationships: ['crm.contact', 'crm.account'],
      message: 'A contact and client must be linked before work begins.',
    },
    {
      stageKey: 'IN_PROGRESS',
      phase: 'EXIT',
      requiredAttributeKeys: ['serviceType'],
      message: 'Record the service type before quality review.',
    },
    {
      stageKey: 'REVIEW',
      phase: 'EXIT',
      requiredRelationships: ['crm.agreement'],
      requiredDecisionOutcomes: ['APPROVE'],
      message: 'Senior approval and a service agreement are required before closing.',
    },
  ],
};

const ACME_CORP_CASE_LIFECYCLE_EVENTS: readonly CaseLifecycleEventMapping[] = [
  { stageKey: 'INTAKE', eventType: 'ServiceRequest.NewRequestEntered', eventVersion: 1 },
  { stageKey: 'IN_PROGRESS', eventType: 'ServiceRequest.InProgressEntered', eventVersion: 1 },
  { stageKey: 'REVIEW', eventType: 'ServiceRequest.QualityReviewEntered', eventVersion: 1 },
  { stageKey: 'RESOLVED', eventType: 'ServiceRequest.Completed', eventVersion: 1 },
];

const ACME_CORP_GOVERNED_ACTION_RULES: readonly GovernedActionRule[] = [
  {
    ruleKey: 'acme-corp.service-request.completed.client-follow-up',
    eventType: 'ServiceRequest.Completed',
    executorClass: 'SCHEDULE',
    actionKey: 'client.follow_up.schedule',
    enabled: true,
    policyKeys: [],
    configuration: {
      delaySeconds: { kind: 'LITERAL', value: 259200 },
      target: {
        executorClass: { kind: 'LITERAL', value: 'COMMUNICATE' },
        actionKey: { kind: 'LITERAL', value: 'client.follow_up' },
        configuration: {
          triggerKey: { kind: 'LITERAL', value: 'client.follow_up' },
          recipient: {
            email: { kind: 'AGGREGATE_FIELD', key: 'contactEmail' },
          },
          variables: {
            clientName: { kind: 'AGGREGATE_FIELD', key: 'contactName' },
            requestSubject: { kind: 'AGGREGATE_FIELD', key: 'subject' },
          },
          purpose: { kind: 'LITERAL', value: 'transactional' },
          consentRequired: { kind: 'LITERAL', value: false },
          channel: { kind: 'LITERAL', value: 'email' },
          locale: { kind: 'LITERAL', value: 'en' },
          capabilityKey: { kind: 'LITERAL', value: 'communication.email.send' },
        },
      },
    },
  },
];

const ACME_CORP_RELATIONSHIP_DEFINITIONS: readonly RelationshipDefinition[] = [
  {
    key: 'assigned_agent',
    label: 'Assigned agent',
    sourceEntityType: 'crm.case',
    targetEntityTypes: ['iam.subject'],
    cardinality: 'ZERO_OR_ONE',
  },
  {
    key: 'service_agreement',
    label: 'Service agreement',
    sourceEntityType: 'crm.case',
    targetEntityTypes: ['crm.agreement'],
    cardinality: 'ZERO_OR_ONE',
  },
];

export const ACME_CORP_PACK: IndustryPack = {
  verticalKey: 'acme-corp',
  label: 'ACME Corp — Multi-service business',
  profile: ACME_CORP_PROFILE,
  terminology: ACME_CORP_TERMINOLOGY,
  caseWorkflow: ACME_CORP_CASE_WORKFLOW,
  caseSchema: ACME_CORP_CASE_SCHEMA,
  caseStageSemantics: ACME_CORP_CASE_STAGE_SEMANTICS,
  relationshipDefinitions: ACME_CORP_RELATIONSHIP_DEFINITIONS,
  caseLifecycleEvents: ACME_CORP_CASE_LIFECYCLE_EVENTS,
  governedActionRules: ACME_CORP_GOVERNED_ACTION_RULES,
  caseOntologyRoles: {
    'crm.contact': 'Requested by contact',
    'crm.account': 'Client account',
    'crm.agreement': 'Under service agreement',
  },
};

// ---------------------------------------------------------------------------
// LEXFLOW — legal matter management. A second pack, to prove the reskin is data,
// not a special case: different words, a different process language, and
// different case data — all configuration over the one neutral engine.
// ---------------------------------------------------------------------------

const LEXFLOW_TERMINOLOGY: PresentationTerminologyCatalogue = {
  defaultLocale: 'en',
  concepts: [
    { conceptKey: 'crm.account', labels: [{ locale: 'en', singular: 'Client', plural: 'Clients' }] },
    { conceptKey: 'crm.contact', labels: [{ locale: 'en', singular: 'Contact', plural: 'Contacts' }] },
    { conceptKey: 'crm.lead', labels: [{ locale: 'en', singular: 'Prospect', plural: 'Prospects' }], aliases: ['enquiry'] },
    { conceptKey: 'crm.case', labels: [{ locale: 'en', singular: 'Matter', plural: 'Matters' }] },
    { conceptKey: 'crm.agreement', labels: [{ locale: 'en', singular: 'Engagement letter', plural: 'Engagement letters' }] },
  ],
};

const LEXFLOW_PROFILE: IndustryProfile = {
  industryKey: 'lexflow',
  label: 'LEXFLOW — Legal practice',
  components: [
    { kind: 'ONTOLOGY', key: 'lexflow.crm', version: 1 },
    { kind: 'TERMINOLOGY', key: 'lexflow.crm', version: 1 },
  ],
};

// The crm.case process is a "Matter" in a law firm; its stages read as the life
// of a legal engagement rather than a generic ticket.
const LEXFLOW_CASE_WORKFLOW: CaseWorkflowVocabulary = {
  workType: 'Matter',
  stages: {
    INTAKE: 'Intake & conflicts',
    IN_PROGRESS: 'Active matter',
    REVIEW: 'Partner review',
    RESOLVED: 'Closed',
  },
  decisionOutcomeLabels: {
    APPROVE: 'Approve & proceed',
    RETURN: 'Return for revision',
  },
  stageGuidance: {
    INTAKE: 'Run the conflicts check and sign the engagement letter.',
    IN_PROGRESS: 'Work the matter.',
    REVIEW: 'A supervising partner reviews before closing.',
    RESOLVED: 'Matter closed and archived.',
  },
};

// A Matter carries legal data a generic case does not: the kind of matter, the
// governing jurisdiction, and the opposing party — the pack configuring its own
// subject fields.
const LEXFLOW_CASE_SCHEMA: CaseSchema = {
  version: 1,
  fields: [
    { key: 'matterType', label: 'Matter type', type: 'select', options: ['Litigation', 'Corporate', 'Real estate', 'Intellectual property', 'Employment'], required: true },
    { key: 'jurisdiction', label: 'Jurisdiction', type: 'text' },
    { key: 'opposingParty', label: 'Opposing party', type: 'text' },
  ],
};

export const LEXFLOW_PACK: IndustryPack = {
  verticalKey: 'lexflow',
  label: 'LEXFLOW — Legal practice',
  profile: LEXFLOW_PROFILE,
  terminology: LEXFLOW_TERMINOLOGY,
  caseWorkflow: LEXFLOW_CASE_WORKFLOW,
  caseSchema: LEXFLOW_CASE_SCHEMA,
  // A Matter is for a Client, has a client contact, under an engagement letter.
  caseOntologyRoles: {
    'crm.contact': 'Client contact',
    'crm.account': 'Client',
    'crm.agreement': 'Under engagement letter',
  },
};

// ---------------------------------------------------------------------------
// Registry + resolution.
// ---------------------------------------------------------------------------

export const INDUSTRY_PACKS: readonly IndustryPack[] = [ACME_CORP_PACK, LEXFLOW_PACK];

export function findIndustryPack(verticalKey: string | null | undefined): IndustryPack | null {
  if (!verticalKey) return null;
  const key = verticalKey.trim().toLowerCase();
  return INDUSTRY_PACKS.find((pack) => pack.verticalKey === key) ?? null;
}

/**
 * Resolve the five CRM concepts to display text for the active vertical, in one
 * pass, with the neutral engine's words as the guaranteed fallback for any
 * concept a pack does not relabel. Pure over the pack's terminology catalogue —
 * no persistence, no transport.
 */
export function resolveCrmVocabulary(
  pack: IndustryPack | null | undefined,
  locale = 'en',
): CrmVocabulary {
  if (!pack) return NEUTRAL_CRM_VOCABULARY;
  const { terminology } = pack;
  const fallbackLocale = terminology.defaultLocale;

  const term = (conceptKey: CrmConcept, fallback: { singular: string; plural: string }) => {
    const concept = terminology.concepts.find((c) => c.conceptKey === conceptKey);
    if (!concept) return fallback;
    const label =
      concept.labels.find((l) => l.locale.toLowerCase() === locale.toLowerCase()) ??
      concept.labels.find((l) => l.locale.toLowerCase() === fallbackLocale.toLowerCase());
    if (!label) return fallback;
    return { singular: label.singular, plural: label.plural };
  };

  return {
    account: term('crm.account', NEUTRAL_CRM_VOCABULARY.account),
    contact: term('crm.contact', NEUTRAL_CRM_VOCABULARY.contact),
    lead: term('crm.lead', NEUTRAL_CRM_VOCABULARY.lead),
    case: term('crm.case', NEUTRAL_CRM_VOCABULARY.case),
    agreement: term('crm.agreement', NEUTRAL_CRM_VOCABULARY.agreement),
  };
}

/**
 * Resolve the crm.case process and stage labels for the active pack, with the
 * neutral engine's words as the guaranteed fallback for the process name and for
 * any stage a pack does not relabel. Pure over the pack's caseWorkflow — no
 * persistence, no transport.
 */
export function resolveCaseWorkflowVocabulary(
  pack: IndustryPack | null | undefined,
): CaseWorkflowVocabulary {
  const words = pack?.caseWorkflow;
  if (!words) return NEUTRAL_CASE_WORKFLOW_VOCABULARY;
  return {
    workType: words.workType?.trim() ? words.workType : NEUTRAL_CASE_WORKFLOW_VOCABULARY.workType,
    stages: { ...NEUTRAL_CASE_WORKFLOW_VOCABULARY.stages, ...words.stages },
    decisionOutcomeLabels: { ...(words.decisionOutcomeLabels ?? {}) },
    stageGuidance: { ...(words.stageGuidance ?? {}) },
  };
}

/**
 * Relabel a canonical decision outcome for the active pack — a clinician sees
 * "Approve treatment plan" where the engine records the canonical APPROVE. Only
 * the crm.case decision experience is reskinned; the recorded outcome, the gate,
 * and the audit trail keep the canonical key. Unrelabelled outcomes (and the
 * neutral engine) fall back to the canonical string.
 */
export function resolveDecisionOutcomeLabel(pack: IndustryPack | null | undefined, outcome: string): string {
  const labels = resolveCaseWorkflowVocabulary(pack).decisionOutcomeLabels ?? {};
  return labels[outcome] ?? outcome;
}

/**
 * Relabel a governed work type for the active pack — the cross-vertical oversight
 * views (in-flight work, decision log) show a work_type_key like `crm.case`; a
 * pack speaks its own word for it (DENTEX: "Treatment"). Only the crm.case
 * process is relabelled (the pack's caseWorkflow); every other vertical, and the
 * neutral engine (no pack), keeps the raw key.
 */
export function resolveWorkTypeLabel(pack: IndustryPack | null | undefined, workTypeKey: string): string {
  if (pack && workTypeKey === 'crm.case') return resolveCaseWorkflowVocabulary(pack).workType;
  return workTypeKey;
}

/**
 * Relabel a governed stage for the active pack — crm.case stages read in the
 * pack's process language (DENTEX: INTAKE → "Consultation"). Other verticals and
 * the neutral engine keep the raw key; an unrelabelled stage falls back to its key.
 */
export function resolveStageLabel(
  pack: IndustryPack | null | undefined,
  workTypeKey: string,
  stageKey: string | null | undefined,
): string {
  if (stageKey && pack && workTypeKey === 'crm.case') {
    return (resolveCaseWorkflowVocabulary(pack).stages as Record<string, string>)[stageKey] ?? stageKey;
  }
  return stageKey ?? '';
}

/** The domain fields the active pack adds to a case — empty for the neutral engine. */
export function resolveCaseSchema(pack: IndustryPack | null | undefined): CaseSchema {
  return pack?.caseSchema ?? NEUTRAL_CASE_SCHEMA;
}

export function resolveGovernedActionRules(
  pack: IndustryPack | null | undefined,
  eventType?: string | null,
): readonly GovernedActionRule[] {
  const rules = pack?.governedActionRules ?? [];
  const type = eventType?.trim();
  if (!type) return rules;
  return rules.filter((rule) => rule.eventType === type);
}

export function resolveCaseLifecycleEvent(
  pack: IndustryPack | null | undefined,
  stageKey: CrmCaseStage,
): CaseLifecycleEventMapping | null {
  const matches = (pack?.caseLifecycleEvents ?? []).filter(
    (mapping) => mapping.stageKey === stageKey,
  );
  if (matches.length > 1) {
    throw new Error(`INDUSTRY_PACK_CASE_LIFECYCLE_EVENT_DUPLICATE:${stageKey}`);
  }
  const mapping = matches[0];
  if (mapping === undefined) return null;
  if (mapping.eventType.trim() === '') {
    throw new Error(`INDUSTRY_PACK_CASE_LIFECYCLE_EVENT_TYPE_REQUIRED:${stageKey}`);
  }
  if (!Number.isInteger(mapping.eventVersion) || mapping.eventVersion <= 0) {
    throw new Error(`INDUSTRY_PACK_CASE_LIFECYCLE_EVENT_VERSION_INVALID:${stageKey}`);
  }
  return mapping;
}

/** Relationship Fabric definitions declared by the active pack. */
export function resolveRelationshipDefinitions(
  pack: IndustryPack | null | undefined,
  sourceEntityType?: string | null,
): readonly RelationshipDefinition[] {
  const definitions = pack?.relationshipDefinitions ?? [];
  const source = sourceEntityType?.trim();
  if (!source) return definitions;
  return definitions.filter((definition) => definition.sourceEntityType === source);
}

/** Executable case-stage semantics declared by the active pack; neutral = none. */
export function resolveCaseStageSemantics(
  pack: IndustryPack | null | undefined,
): CaseWorkflowSemantics {
  return pack?.caseStageSemantics ?? NEUTRAL_CASE_WORKFLOW_SEMANTICS;
}

/**
 * The case's domain model for the active pack, composed — not stored — from what
 * the pack already declares: the case entity's name (its work type), its typed
 * relationships to the canonical CRM entities it links (account/contact/agreement,
 * labelled and roled in the pack's words), and its declared domain fields. This
 * makes the ontology explicit; it adds no data and changes no canonical link.
 * The neutral engine yields a generic "Case" model over the same canonical
 * relations. Pure over the pack's vocabularies and schema.
 */
export function resolveCaseOntology(pack: IndustryPack | null | undefined): CaseOntology {
  const crm = resolveCrmVocabulary(pack);
  const roles = pack?.caseOntologyRoles ?? {};
  const labelFor: Record<CaseRelationshipConcept, string> = {
    'crm.account': crm.account.singular,
    'crm.contact': crm.contact.singular,
    'crm.agreement': crm.agreement.singular,
  };
  return {
    entity: resolveCaseWorkflowVocabulary(pack).workType,
    relationships: CASE_RELATIONSHIP_CONCEPTS.map((conceptKey) => ({
      conceptKey,
      entityLabel: labelFor[conceptKey],
      role: roles[conceptKey] ?? NEUTRAL_CASE_RELATIONSHIP_ROLES[conceptKey],
    })),
    fields: resolveCaseSchema(pack).fields,
  };
}

export interface CaseAttributeValidation {
  readonly ok: boolean;
  /** The attributes narrowed to the schema's known keys, trimmed. */
  readonly attributes: Record<string, string>;
  /** Human-readable problems, keyed loosely by field. */
  readonly errors: string[];
  /**
   * The schema revision that validated these attributes — stamped onto the case
   * so its stored values stay tied to the field set that produced them. 0 for
   * the neutral engine (no schema); the caller persists null for 0.
   */
  readonly schemaVersion: number;
}

/**
 * Validate and normalize a case's domain attributes against the pack's schema,
 * purely: unknown keys are dropped, required fields must be present, and a select
 * field's value must be one of its options. Values are coerced to trimmed
 * strings (the JSONB column stores text values); the caller persists
 * `attributes` on the case. No schema field → nothing to validate.
 */
export function validateCaseAttributes(
  schema: CaseSchema,
  input: Record<string, unknown> | null | undefined,
): CaseAttributeValidation {
  const raw = input ?? {};
  const attributes: Record<string, string> = {};
  const errors: string[] = [];
  for (const field of schema.fields) {
    const present = Object.prototype.hasOwnProperty.call(raw, field.key) && raw[field.key] !== null && raw[field.key] !== undefined;
    const value = present ? String(raw[field.key]).trim() : '';
    if (value === '') {
      if (field.required) errors.push(`${field.label} is required.`);
      continue;
    }
    if (field.type === 'number' && Number.isNaN(Number(value))) {
      errors.push(`${field.label} must be a number.`);
      continue;
    }
    if (field.type === 'select' && field.options !== undefined && !field.options.includes(value)) {
      errors.push(`${field.label} must be one of: ${field.options.join(', ')}.`);
      continue;
    }
    attributes[field.key] = value;
  }
  return { ok: errors.length === 0, attributes, errors, schemaVersion: schema.version };
}

/** The packs a workspace can choose from, for a picker. */
export function listIndustryPackChoices(): readonly { verticalKey: string; label: string }[] {
  return INDUSTRY_PACKS.map((p) => ({ verticalKey: p.verticalKey, label: p.label }));
}

/**
 * Everything a pack configures, as a flat descriptor — the management plane's
 * read model. An admin reviews what adopting a pack changes (entity words, the
 * case process language, the case's data fields and their schema version, and
 * the domain relationships) before binding it. Composed from the pack's own
 * declarations; adds nothing.
 */
export interface IndustryPackCapabilities {
  readonly verticalKey: string;
  readonly label: string;
  /** The pack's singular nouns for the five CRM concepts. */
  readonly entities: {
    readonly account: string;
    readonly contact: string;
    readonly lead: string;
    readonly case: string;
    readonly agreement: string;
  };
  /** The case process's name and its stage labels, in order. */
  readonly workType: string;
  readonly stages: readonly { readonly key: CrmCaseStage; readonly label: string }[];
  /** The case's declared domain fields and the schema revision they belong to. */
  readonly caseSchemaVersion: number;
  readonly caseFields: readonly { readonly key: string; readonly label: string; readonly type: string; readonly required: boolean }[];
  /** The case's typed relationships to the canonical CRM entities. */
  readonly relationships: readonly CaseOntologyRelationship[];
  /** Authoritative Relationship Fabric declarations supplied by the pack. */
  readonly relationshipDefinitions: readonly RelationshipDefinition[];
}

/** Describe a single pack's full capability surface. */
export function describeIndustryPack(pack: IndustryPack): IndustryPackCapabilities {
  const crm = resolveCrmVocabulary(pack);
  const wf = resolveCaseWorkflowVocabulary(pack);
  const schema = resolveCaseSchema(pack);
  const ontology = resolveCaseOntology(pack);
  return {
    verticalKey: pack.verticalKey,
    label: pack.label,
    entities: {
      account: crm.account.singular,
      contact: crm.contact.singular,
      lead: crm.lead.singular,
      case: crm.case.singular,
      agreement: crm.agreement.singular,
    },
    workType: wf.workType,
    stages: CRM_CASE_STAGES.map((key) => ({ key, label: wf.stages[key] })),
    caseSchemaVersion: schema.version,
    caseFields: schema.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required === true })),
    relationships: ontology.relationships,
    relationshipDefinitions: resolveRelationshipDefinitions(pack),
  };
}

/** The full pack catalog — every registered pack's capability descriptor. */
export function listIndustryPackCatalog(): readonly IndustryPackCapabilities[] {
  return INDUSTRY_PACKS.map(describeIndustryPack);
}

export * from './authoring.ts';
export * from './authoring-repository.ts';
export * from './authoring-lifecycle.ts';
export * from './runtime-resolver.ts';

export * from './definition-validation.ts';

export * from './case-stage-semantic-evaluator.ts';
