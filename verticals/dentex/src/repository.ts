import type {
  CarePlan,
  DentexAuditContext,
  DentexTenantContext,
  Patient,
  Practice,
  Provider,
  Referral,
  Treatment,
  UUID,
} from './domain.ts';
import type { DentexDomainEvent } from './events.ts';

export interface DentexWriteContext extends DentexTenantContext {
  audit: DentexAuditContext;
}

export interface DentexEntityLookup extends DentexTenantContext {
  id: UUID;
}

export interface DentexReferenceLookup extends DentexTenantContext {
  reference: string;
}

export interface DentexPatientRepository {
  getById(lookup: DentexEntityLookup): Promise<Patient | null>;
  getByReference(lookup: DentexReferenceLookup): Promise<Patient | null>;
  save(context: DentexWriteContext, patient: Patient): Promise<Patient>;
}

export interface DentexPracticeRepository {
  getById(lookup: DentexEntityLookup): Promise<Practice | null>;
  getByReference(lookup: DentexReferenceLookup): Promise<Practice | null>;
  save(context: DentexWriteContext, practice: Practice): Promise<Practice>;
}

export interface DentexProviderRepository {
  getById(lookup: DentexEntityLookup): Promise<Provider | null>;
  listByPractice(context: DentexTenantContext & { practiceId: UUID }): Promise<Provider[]>;
  save(context: DentexWriteContext, provider: Provider): Promise<Provider>;
}

export interface DentexReferralRepository {
  getById(lookup: DentexEntityLookup): Promise<Referral | null>;
  getByReference(lookup: DentexReferenceLookup): Promise<Referral | null>;
  listByPatient(context: DentexTenantContext & { patientId: UUID }): Promise<Referral[]>;
  save(context: DentexWriteContext, referral: Referral): Promise<Referral>;
}

export interface DentexCarePlanRepository {
  getById(lookup: DentexEntityLookup): Promise<CarePlan | null>;
  listByPatient(context: DentexTenantContext & { patientId: UUID }): Promise<CarePlan[]>;
  save(context: DentexWriteContext, carePlan: CarePlan): Promise<CarePlan>;
}

export interface DentexTreatmentRepository {
  getById(lookup: DentexEntityLookup): Promise<Treatment | null>;
  getByReference(lookup: DentexReferenceLookup): Promise<Treatment | null>;
  listByPatient(context: DentexTenantContext & { patientId: UUID }): Promise<Treatment[]>;
  save(context: DentexWriteContext, treatment: Treatment): Promise<Treatment>;
}

export interface DentexDomainEventRepository {
  append(context: DentexWriteContext, event: DentexDomainEvent): Promise<void>;
}

export interface DentexUnitOfWork {
  patients: DentexPatientRepository;
  practices: DentexPracticeRepository;
  providers: DentexProviderRepository;
  referrals: DentexReferralRepository;
  carePlans: DentexCarePlanRepository;
  treatments: DentexTreatmentRepository;
  domainEvents: DentexDomainEventRepository;
}

export interface DentexRepositoryProvider {
  withTenantTransaction<T>(
    context: DentexWriteContext,
    work: (repositories: DentexUnitOfWork) => Promise<T>,
  ): Promise<T>;
}
