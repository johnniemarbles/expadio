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
  readonly practiceId: string | null;
  readonly patientId: string | null;
  readonly carePlanAgreementId: string | null;
  readonly subject: string;
  readonly description: string | null;
  readonly priority: CasePriority;
  readonly status: CaseStatus;
  readonly stage: DentexTreatmentStage | null;
  readonly schemaVersion: number;
  readonly attributes: DentexTreatmentAttributes;
}


export interface DentexPatientSummary {
  readonly patientId: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: string;
}

export interface DentexPracticeSummary {
  readonly practiceId: string;
  readonly name: string;
  readonly industry: string | null;
  readonly status: string;
}

export interface DentexSubjectSummary {
  readonly subjectId: string;
}

export interface DentexTreatmentWorkflowSummary {
  readonly instanceId: string;
  readonly state: string;
  readonly currentStage: DentexTreatmentStage | null;
  readonly revision: number;
  readonly blueprintKey: string;
  readonly blueprintVersion: number;
}

export interface DentexCarePlanSummary {
  readonly agreementId: string;
  readonly title: string;
  readonly status: string;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
}

/**
 * Product-facing DENTEX Treatment read model.
 *
 * Each field remains hydrated from an existing horizontal authority:
 * Patient/Practice -> CRM Party, owner -> crm.case, provider -> Relationship
 * Fabric, workflow -> Decision Fabric, Care Plan -> CRM Agreement.
 */
export interface DentexTreatmentWorkspace {
  readonly treatment: DentexTreatment;
  readonly patient: DentexPatientSummary | null;
  readonly practice: DentexPracticeSummary | null;
  readonly owner: DentexSubjectSummary | null;
  readonly provider: DentexSubjectSummary | null;
  readonly workflow: DentexTreatmentWorkflowSummary | null;
  readonly carePlan: DentexCarePlanSummary | null;
  readonly pack: {
    readonly verticalKey: 'dentex';
    readonly version: number | null;
    readonly runtimeSource: string;
  };
}
