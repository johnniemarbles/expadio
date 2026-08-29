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
}

/** The neutral engine's own words for the case lifecycle — the fallback. */
export const NEUTRAL_CASE_WORKFLOW_VOCABULARY: CaseWorkflowVocabulary = {
  workType: 'Case',
  stages: { INTAKE: 'Intake', IN_PROGRESS: 'In progress', REVIEW: 'Review', RESOLVED: 'Resolved' },
};

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
}

// ---------------------------------------------------------------------------
// DENTEX — dental practice management.
// ---------------------------------------------------------------------------

const DENTEX_TERMINOLOGY: PresentationTerminologyCatalogue = {
  defaultLocale: 'en',
  concepts: [
    { conceptKey: 'crm.account', labels: [{ locale: 'en', singular: 'Practice', plural: 'Practices' }] },
    { conceptKey: 'crm.contact', labels: [{ locale: 'en', singular: 'Patient', plural: 'Patients' }] },
    { conceptKey: 'crm.lead', labels: [{ locale: 'en', singular: 'Referral', plural: 'Referrals' }], aliases: ['enquiry'] },
    { conceptKey: 'crm.case', labels: [{ locale: 'en', singular: 'Treatment', plural: 'Treatments' }] },
    { conceptKey: 'crm.agreement', labels: [{ locale: 'en', singular: 'Care plan', plural: 'Care plans' }] },
  ],
};

const DENTEX_PROFILE: IndustryProfile = {
  industryKey: 'dentex',
  label: 'DENTEX — Dental practice',
  components: [
    // An IndustryProfile must carry an ONTOLOGY and a TERMINOLOGY foundation.
    { kind: 'ONTOLOGY', key: 'dentex.crm', version: 1 },
    { kind: 'TERMINOLOGY', key: 'dentex.crm', version: 1 },
  ],
};

// The crm.case process is a "Treatment" in a dental practice; its stages read
// as a course of care rather than a generic ticket lifecycle.
const DENTEX_CASE_WORKFLOW: CaseWorkflowVocabulary = {
  workType: 'Treatment',
  stages: {
    INTAKE: 'Consultation',
    IN_PROGRESS: 'In treatment',
    REVIEW: 'Clinical review',
    RESOLVED: 'Discharged',
  },
};

export const DENTEX_PACK: IndustryPack = {
  verticalKey: 'dentex',
  label: 'DENTEX — Dental practice',
  profile: DENTEX_PROFILE,
  terminology: DENTEX_TERMINOLOGY,
  caseWorkflow: DENTEX_CASE_WORKFLOW,
};

// ---------------------------------------------------------------------------
// Registry + resolution.
// ---------------------------------------------------------------------------

export const INDUSTRY_PACKS: readonly IndustryPack[] = [DENTEX_PACK];

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
  };
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

/** The packs a workspace can choose from, for a picker. */
export function listIndustryPackChoices(): readonly { verticalKey: string; label: string }[] {
  return INDUSTRY_PACKS.map((p) => ({ verticalKey: p.verticalKey, label: p.label }));
}
