import type { CasePriority, CaseStatus } from '@expadio/case';

export const DENTEX_TREATMENT_WORK_TYPE_KEY = 'crm.case' as const;

export const DENTEX_TREATMENT_ATTRIBUTE_KEYS = [
  'tooth',
  'procedureCode',
  'urgency',
] as const;

export type DentexTreatmentAttributeKey =
  (typeof DENTEX_TREATMENT_ATTRIBUTE_KEYS)[number];

export const DENTEX_TREATMENT_URGENCIES = [
  'Routine',
  'Priority',
  'Emergency',
] as const;

export type DentexTreatmentUrgency =
  (typeof DENTEX_TREATMENT_URGENCIES)[number];

export type DentexTreatmentStage =
  | 'INTAKE'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'RESOLVED';

export interface DentexTreatmentAttributes {
  readonly tooth?: string;
  readonly procedureCode?: string;
  readonly urgency: DentexTreatmentUrgency;
}

/**
 * DENTEX Treatment is a vertical projection over the canonical crm.case.
 *
 * The identifiers below deliberately retain the horizontal engine's canonical
 * relationships:
 * - practiceId -> crm.account
 * - patientId -> crm.contact
 * - carePlanAgreementId -> crm.agreement
 *
 * No DENTEX-only persistence primitive is introduced by this contract.
 */
export interface DentexTreatment {
  readonly treatmentId: string;
  readonly tenantId: string;
  readonly practiceId: string;
  readonly patientId: string;
  readonly carePlanAgreementId: string | null;
  readonly subject: string;
  readonly description: string | null;
  readonly priority: CasePriority;
  readonly status: CaseStatus;
  readonly stage: DentexTreatmentStage | null;
  readonly schemaVersion: number;
  readonly attributes: DentexTreatmentAttributes;
}
