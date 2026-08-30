export const DENTEX_VERTICAL_KEY = 'dentex' as const;

export type UUID = string;
export type ISODateTime = string;

export interface DentexTenantContext {
  tenantId: UUID;
  organizationId: UUID;
}

export interface DentexAuditContext {
  subjectId?: UUID;
  correlationId?: UUID;
  source: 'crm' | 'portal' | 'integration' | 'migration' | 'system';
}

export interface DentexEntityBase extends DentexTenantContext {
  id: UUID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Patient extends DentexEntityBase {
  patientReference: string;
  displayName: string;
  dateOfBirth?: string;
  primaryPhone?: string;
  primaryEmail?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
}

export interface Practice extends DentexEntityBase {
  practiceReference: string;
  legalName: string;
  displayName: string;
  regionKey?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

export interface Provider extends DentexEntityBase {
  providerReference: string;
  practiceId: UUID;
  displayName: string;
  providerType: 'DENTIST' | 'HYGIENIST' | 'SPECIALIST' | 'ASSISTANT' | 'ADMIN';
  status: 'ACTIVE' | 'INACTIVE';
}

export interface Referral extends DentexEntityBase {
  referralReference: string;
  patientId: UUID;
  sourcePracticeId?: UUID;
  targetPracticeId: UUID;
  reason: string;
  status: 'RECEIVED' | 'TRIAGED' | 'ACCEPTED' | 'DECLINED' | 'CLOSED';
}

export interface Tooth {
  notation: string;
  system: 'FDI' | 'UNIVERSAL' | 'PALMER';
  surface?: 'MESIAL' | 'DISTAL' | 'OCCLUSAL' | 'BUCCAL' | 'LINGUAL' | 'INCISAL';
}

export interface Procedure {
  procedureCode: string;
  description: string;
  tooth?: Tooth;
  priority: 'LOW' | 'NORMAL' | 'URGENT';
  estimatedMinutes?: number;
}

export interface CarePlan extends DentexEntityBase {
  carePlanReference: string;
  patientId: UUID;
  practiceId: UUID;
  providerId?: UUID;
  procedures: Procedure[];
  status: 'DRAFT' | 'PROPOSED' | 'ACCEPTED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}

export interface Treatment extends DentexEntityBase {
  treatmentReference: string;
  patientId: UUID;
  practiceId: UUID;
  providerId?: UUID;
  referralId?: UUID;
  carePlanId?: UUID;
  procedures: Procedure[];
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'DISCHARGED' | 'CANCELLED';
  dischargedAt?: ISODateTime;
}
