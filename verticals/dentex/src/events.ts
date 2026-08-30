import type { DentexAuditContext, DentexTenantContext, ISODateTime, Procedure, UUID } from './domain.ts';

export type DentexDomainEventType =
  | 'dentex.patient.registered'
  | 'dentex.referral.received'
  | 'dentex.treatment.planned'
  | 'dentex.treatment.discharged';

export interface DentexDecisionContext {
  decisionTraceId?: UUID;
  policyVersion?: string;
  workflowBlueprintKey?: string;
}

export interface DentexDomainEventBase extends DentexTenantContext {
  eventId: UUID;
  eventType: DentexDomainEventType;
  aggregateId: UUID;
  aggregateType: 'Patient' | 'Referral' | 'Treatment';
  occurredAt: ISODateTime;
  audit: DentexAuditContext;
  decision?: DentexDecisionContext;
}

export interface DentexPatientRegistered extends DentexDomainEventBase {
  eventType: 'dentex.patient.registered';
  aggregateType: 'Patient';
  payload: {
    patientId: UUID;
    patientReference: string;
    practiceId?: UUID;
  };
}

export interface DentexReferralReceived extends DentexDomainEventBase {
  eventType: 'dentex.referral.received';
  aggregateType: 'Referral';
  payload: {
    referralId: UUID;
    referralReference: string;
    patientId: UUID;
    targetPracticeId: UUID;
    reason: string;
  };
}

export interface DentexTreatmentPlanned extends DentexDomainEventBase {
  eventType: 'dentex.treatment.planned';
  aggregateType: 'Treatment';
  payload: {
    treatmentId: UUID;
    treatmentReference: string;
    patientId: UUID;
    practiceId: UUID;
    providerId?: UUID;
    procedures: Procedure[];
  };
}

export interface DentexTreatmentDischarged extends DentexDomainEventBase {
  eventType: 'dentex.treatment.discharged';
  aggregateType: 'Treatment';
  payload: {
    treatmentId: UUID;
    treatmentReference: string;
    patientId: UUID;
    practiceId: UUID;
    dischargedAt: ISODateTime;
    followUpRequired: boolean;
  };
}

export type DentexDomainEvent =
  | DentexPatientRegistered
  | DentexReferralReceived
  | DentexTreatmentPlanned
  | DentexTreatmentDischarged;

export function isDentexDomainEvent(event: DentexDomainEvent): event is DentexDomainEvent {
  return event.tenantId.length > 0 && event.organizationId.length > 0 && event.occurredAt.length > 0;
}
