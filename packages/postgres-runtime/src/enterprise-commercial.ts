import { randomUUID } from 'node:crypto';
import {
  RepositoryWorkflowActivationService,
  RepositoryWorkflowActivationVerificationService,
  RepositoryWorkflowRightsGrantService,
  type WorkflowActivationVerificationAssessment,
  type WorkflowRightsGrant,
} from '@expadio/workflow';
import type { PostgresClient } from './index.ts';
import { appendDomainEventWithOutbox } from './domain-events.ts';
import { PostgresWorkflowActivationRepository } from './workflow-activation.ts';
import { PostgresWorkflowActivationBlueprintProvider } from './workflow-activation-blueprint.ts';
import { PostgresWorkflowActivationVerificationRepository } from './workflow-activation-verification.ts';
import { PostgresWorkflowRightsGrantRepository } from './workflow-rights.ts';
import { PostgresWorkflowRightsProfileProvider } from './workflow-rights-profile.ts';
import { publishGovernedEntityRelationship } from './entity-graph.ts';

export type EnterpriseTerritoryKind =
  | 'GLOBAL'
  | 'COUNTRY'
  | 'SUBDIVISION'
  | 'LOCALITY'
  | 'CUSTOM';

export type EnterpriseCommercialAgreementKind =
  | 'FRANCHISE'
  | 'MASTER_FRANCHISE'
  | 'DISTRIBUTION'
  | 'WHOLESALE'
  | 'RETAIL'
  | 'AFFILIATE'
  | 'BROKER'
  | 'LICENSE'
  | 'AGENCY'
  | 'MANAGEMENT'
  | 'SERVICE'
  | 'JOINT_VENTURE'
  | 'OTHER';

export type EnterpriseAppointmentKind =
  | 'MASTER_FRANCHISEE'
  | 'FRANCHISEE'
  | 'DISTRIBUTOR'
  | 'WHOLESALER'
  | 'RETAILER'
  | 'AFFILIATE'
  | 'BROKER'
  | 'LICENSEE'
  | 'OPERATOR'
  | 'AGENT'
  | 'MANAGEMENT_PROVIDER'
  | 'SERVICE_PROVIDER'
  | 'JV_PARTNER'
  | 'OTHER';

export interface EnterpriseTerritory {
  readonly territoryId: string;
  readonly tenantId: string;
  readonly enterpriseId: string;
  readonly parentTerritoryId: string | null;
  readonly territoryKey: string;
  readonly name: string;
  readonly territoryKind: EnterpriseTerritoryKind;
  readonly countryCode: string | null;
  readonly subdivisionCode: string | null;
  readonly localityName: string | null;
  readonly externalGeographyRef: string | null;
  readonly status: 'ACTIVE' | 'INACTIVE';
}

export interface EnterpriseCommercialAgreement {
  readonly agreementId: string;
  readonly tenantId: string;
  readonly enterpriseId: string;
  readonly agreementNumber: string | null;
  readonly title: string;
  readonly agreementKind: EnterpriseCommercialAgreementKind;
  readonly grantorLegalEntityId: string;
  readonly granteeLegalEntityId: string;
  readonly sponsoringOrganizationId: string;
  readonly state:
    | 'DRAFT'
    | 'UNDER_REVIEW'
    | 'APPROVED'
    | 'ACTIVE'
    | 'SUSPENDED'
    | 'EXPIRED'
    | 'TERMINATED';
  readonly effectiveFrom: string | null;
  readonly effectiveUntil: string | null;
  readonly executionEvidenceRefs: readonly string[];
  readonly idempotencyKey: string;
}

export interface EnterpriseAppointment {
  readonly appointmentId: string;
  readonly tenantId: string;
  readonly enterpriseId: string;
  readonly agreementId: string;
  readonly grantorOrganizationId: string;
  readonly beneficiaryOrganizationId: string;
  readonly beneficiaryLegalEntityId: string;
  readonly appointmentKind: EnterpriseAppointmentKind;
  readonly rightsProfileKey: string;
  readonly rightsProfileVersion: number;
  readonly requestedRightTypes: readonly string[];
  readonly exclusivityKey: string | null;
  readonly delegationRequested: boolean;
  readonly subAppointmentRequested: boolean;
  readonly channelKeys: readonly string[];
  readonly productKeys: readonly string[];
  readonly state:
    | 'DRAFT'
    | 'SUBMITTED'
    | 'UNDER_REVIEW'
    | 'APPROVED'
    | 'REJECTED'
    | 'RIGHTS_PENDING'
    | 'ACTIVE'
    | 'SUSPENDED'
    | 'REVOKED'
    | 'EXPIRED';
  readonly workflowInstanceId: string | null;
  readonly workflowRightsGrantId: string | null;
  readonly effectiveFrom: string | null;
  readonly effectiveUntil: string | null;
  readonly idempotencyKey: string;
}

export interface EnterpriseJurisdictionActivation {
  readonly jurisdictionActivationId: string;
  readonly tenantId: string;
  readonly enterpriseId: string;
  readonly organizationId: string;
  readonly appointmentId: string;
  readonly territoryId: string;
  readonly workflowActivationId: string | null;
  readonly state:
    | 'PLANNING'
    | 'ACTIVATION_REVIEW'
    | 'APPROVED'
    | 'ACTIVE'
    | 'SUSPENDED'
    | 'REVOKED';
  readonly idempotencyKey: string;
  readonly evidenceRefs: readonly string[];
}

interface TerritoryRow {
  readonly territory_id: string;
  readonly tenant_id: string;
  readonly enterprise_id: string;
  readonly parent_territory_id: string | null;
  readonly territory_key: string;
  readonly name: string;
  readonly territory_kind: EnterpriseTerritoryKind;
  readonly country_code: string | null;
  readonly subdivision_code: string | null;
  readonly locality_name: string | null;
  readonly external_geography_ref: string | null;
  readonly status: 'ACTIVE' | 'INACTIVE';
}

interface AgreementRow {
  readonly enterprise_commercial_agreement_id: string;
  readonly tenant_id: string;
  readonly enterprise_id: string;
  readonly agreement_number: string | null;
  readonly title: string;
  readonly agreement_kind: EnterpriseCommercialAgreementKind;
  readonly grantor_legal_entity_id: string;
  readonly grantee_legal_entity_id: string;
  readonly sponsoring_organization_id: string;
  readonly state: EnterpriseCommercialAgreement['state'];
  readonly effective_from: Date | string | null;
  readonly effective_until: Date | string | null;
  readonly execution_evidence_refs: readonly string[];
  readonly idempotency_key: string;
  readonly created_by_subject_id: string;
}

interface AppointmentRow {
  readonly enterprise_appointment_id: string;
  readonly tenant_id: string;
  readonly enterprise_id: string;
  readonly enterprise_commercial_agreement_id: string;
  readonly grantor_organization_id: string;
  readonly beneficiary_organization_id: string;
  readonly beneficiary_legal_entity_id: string;
  readonly appointment_kind: EnterpriseAppointmentKind;
  readonly rights_profile_key: string;
  readonly rights_profile_version: number;
  readonly requested_right_types: readonly string[];
  readonly exclusivity_key: string | null;
  readonly delegation_requested: boolean;
  readonly sub_appointment_requested: boolean;
  readonly channel_keys: readonly string[];
  readonly product_keys: readonly string[];
  readonly state: EnterpriseAppointment['state'];
  readonly workflow_instance_id: string | null;
  readonly workflow_rights_grant_id: string | null;
  readonly effective_from: Date | string | null;
  readonly effective_until: Date | string | null;
  readonly idempotency_key: string;
  readonly requested_by_subject_id: string;
}

interface JurisdictionRow {
  readonly enterprise_jurisdiction_activation_id: string;
  readonly tenant_id: string;
  readonly enterprise_id: string;
  readonly organization_id: string;
  readonly enterprise_appointment_id: string;
  readonly territory_id: string;
  readonly workflow_activation_id: string | null;
  readonly state: EnterpriseJurisdictionActivation['state'];
  readonly idempotency_key: string;
  readonly evidence_refs: readonly string[];
  readonly requested_by_subject_id: string;
}

const TERRITORY_SELECT = `territory_id, tenant_id, enterprise_id,
  parent_territory_id, territory_key, name, territory_kind, country_code,
  subdivision_code, locality_name, external_geography_ref, status`;

const AGREEMENT_SELECT = `enterprise_commercial_agreement_id, tenant_id,
  enterprise_id, agreement_number, title, agreement_kind,
  grantor_legal_entity_id, grantee_legal_entity_id,
  sponsoring_organization_id, state, effective_from, effective_until,
  execution_evidence_refs, idempotency_key, created_by_subject_id`;

const APPOINTMENT_SELECT = `enterprise_appointment_id, tenant_id, enterprise_id,
  enterprise_commercial_agreement_id, grantor_organization_id,
  beneficiary_organization_id, beneficiary_legal_entity_id, appointment_kind,
  rights_profile_key, rights_profile_version, requested_right_types,
  exclusivity_key, delegation_requested, sub_appointment_requested,
  channel_keys, product_keys, state, workflow_instance_id,
  workflow_rights_grant_id, effective_from, effective_until, idempotency_key,
  requested_by_subject_id`;

const JURISDICTION_SELECT = `enterprise_jurisdiction_activation_id, tenant_id,
  enterprise_id, organization_id, enterprise_appointment_id, territory_id,
  workflow_activation_id, state, idempotency_key, evidence_refs,
  requested_by_subject_id`;

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function territory(row: TerritoryRow): EnterpriseTerritory {
  return {
    territoryId: row.territory_id,
    tenantId: row.tenant_id,
    enterpriseId: row.enterprise_id,
    parentTerritoryId: row.parent_territory_id,
    territoryKey: row.territory_key,
    name: row.name,
    territoryKind: row.territory_kind,
    countryCode: row.country_code,
    subdivisionCode: row.subdivision_code,
    localityName: row.locality_name,
    externalGeographyRef: row.external_geography_ref,
    status: row.status,
  };
}

function agreement(row: AgreementRow): EnterpriseCommercialAgreement {
  return {
    agreementId: row.enterprise_commercial_agreement_id,
    tenantId: row.tenant_id,
    enterpriseId: row.enterprise_id,
    agreementNumber: row.agreement_number,
    title: row.title,
    agreementKind: row.agreement_kind,
    grantorLegalEntityId: row.grantor_legal_entity_id,
    granteeLegalEntityId: row.grantee_legal_entity_id,
    sponsoringOrganizationId: row.sponsoring_organization_id,
    state: row.state,
    effectiveFrom: nullableIso(row.effective_from),
    effectiveUntil: nullableIso(row.effective_until),
    executionEvidenceRefs: [...row.execution_evidence_refs],
    idempotencyKey: row.idempotency_key,
  };
}

function appointment(row: AppointmentRow): EnterpriseAppointment {
  return {
    appointmentId: row.enterprise_appointment_id,
    tenantId: row.tenant_id,
    enterpriseId: row.enterprise_id,
    agreementId: row.enterprise_commercial_agreement_id,
    grantorOrganizationId: row.grantor_organization_id,
    beneficiaryOrganizationId: row.beneficiary_organization_id,
    beneficiaryLegalEntityId: row.beneficiary_legal_entity_id,
    appointmentKind: row.appointment_kind,
    rightsProfileKey: row.rights_profile_key,
    rightsProfileVersion: Number(row.rights_profile_version),
    requestedRightTypes: [...row.requested_right_types],
    exclusivityKey: row.exclusivity_key,
    delegationRequested: row.delegation_requested,
    subAppointmentRequested: row.sub_appointment_requested,
    channelKeys: [...row.channel_keys],
    productKeys: [...row.product_keys],
    state: row.state,
    workflowInstanceId: row.workflow_instance_id,
    workflowRightsGrantId: row.workflow_rights_grant_id,
    effectiveFrom: nullableIso(row.effective_from),
    effectiveUntil: nullableIso(row.effective_until),
    idempotencyKey: row.idempotency_key,
  };
}

function jurisdiction(row: JurisdictionRow): EnterpriseJurisdictionActivation {
  return {
    jurisdictionActivationId: row.enterprise_jurisdiction_activation_id,
    tenantId: row.tenant_id,
    enterpriseId: row.enterprise_id,
    organizationId: row.organization_id,
    appointmentId: row.enterprise_appointment_id,
    territoryId: row.territory_id,
    workflowActivationId: row.workflow_activation_id,
    state: row.state,
    idempotencyKey: row.idempotency_key,
    evidenceRefs: [...row.evidence_refs],
  };
}

const APPOINTMENT_POLICIES: Readonly<
  Record<
    Exclude<EnterpriseAppointmentKind, 'OTHER'>,
    { readonly profileKey: string; readonly rightTypes: readonly string[];
      readonly delegation: boolean; readonly subAppointment: boolean }
  >
> = {
  MASTER_FRANCHISEE: {
    profileKey: 'enterprise.master-operator',
    rightTypes: ['OPERATE','SELL','DISTRIBUTE','WHOLESALE','RETAIL','SUB_APPOINT'],
    delegation: true,
    subAppointment: true,
  },
  FRANCHISEE: {
    profileKey: 'enterprise.operator',
    rightTypes: ['OPERATE','SELL','RETAIL'],
    delegation: false,
    subAppointment: false,
  },
  DISTRIBUTOR: {
    profileKey: 'enterprise.channel-partner',
    rightTypes: ['DISTRIBUTE','SELL'],
    delegation: false,
    subAppointment: false,
  },
  WHOLESALER: {
    profileKey: 'enterprise.channel-partner',
    rightTypes: ['WHOLESALE','SELL'],
    delegation: false,
    subAppointment: false,
  },
  RETAILER: {
    profileKey: 'enterprise.operator',
    rightTypes: ['RETAIL','SELL'],
    delegation: false,
    subAppointment: false,
  },
  AFFILIATE: {
    profileKey: 'enterprise.channel-partner',
    rightTypes: ['REFER'],
    delegation: false,
    subAppointment: false,
  },
  BROKER: {
    profileKey: 'enterprise.channel-partner',
    rightTypes: ['BROKER'],
    delegation: false,
    subAppointment: false,
  },
  LICENSEE: {
    profileKey: 'enterprise.licensee',
    rightTypes: ['LICENSE','OPERATE'],
    delegation: false,
    subAppointment: false,
  },
  OPERATOR: {
    profileKey: 'enterprise.operator',
    rightTypes: ['OPERATE','SELL','RETAIL','SERVICE','MANAGE'],
    delegation: false,
    subAppointment: false,
  },
  AGENT: {
    profileKey: 'enterprise.channel-partner',
    rightTypes: ['SELL','REFER'],
    delegation: false,
    subAppointment: false,
  },
  MANAGEMENT_PROVIDER: {
    profileKey: 'enterprise.service-provider',
    rightTypes: ['MANAGE','SERVICE'],
    delegation: false,
    subAppointment: false,
  },
  SERVICE_PROVIDER: {
    profileKey: 'enterprise.service-provider',
    rightTypes: ['SERVICE'],
    delegation: false,
    subAppointment: false,
  },
  JV_PARTNER: {
    profileKey: 'enterprise.jv-partner',
    rightTypes: ['OPERATE','MANAGE','SERVICE'],
    delegation: false,
    subAppointment: false,
  },
};

function appointmentPolicy(kind: EnterpriseAppointmentKind) {
  if (kind === 'OTHER') throw new Error('ENTERPRISE_APPOINTMENT_KIND_REQUIRES_POLICY');
  return APPOINTMENT_POLICIES[kind];
}

function canonicalStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

async function appendEnterpriseEvent(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly eventType: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
    readonly payload: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: { ...input.payload },
      metadata: { source: 'enterprise.commercial-network' },
    },
  });
}

export async function createEnterpriseTerritory(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly enterpriseId: string;
    readonly parentTerritoryId?: string | null;
    readonly territoryKey: string;
    readonly name: string;
    readonly territoryKind: EnterpriseTerritoryKind;
    readonly countryCode?: string | null;
    readonly subdivisionCode?: string | null;
    readonly localityName?: string | null;
    readonly externalGeographyRef?: string | null;
    readonly createdBySubjectId: string;
    readonly correlationId: string;
  },
): Promise<{ readonly territory: EnterpriseTerritory; readonly idempotent: boolean }> {
  const key = input.territoryKey.trim().toLowerCase();
  const name = input.name.trim();
  if (!key || !name) throw new Error('ENTERPRISE_TERRITORY_INPUT_REQUIRED');

  const existing = await client.query<TerritoryRow>(
    `SELECT ${TERRITORY_SELECT}
       FROM platform.enterprise_territories
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
        AND lower(territory_key) = $3
      LIMIT 1`,
    [input.tenantId, input.enterpriseId, key],
  );
  const prior = existing.rows[0];
  if (prior) {
    const exact =
      prior.parent_territory_id === (input.parentTerritoryId ?? null)
      && prior.name === name
      && prior.territory_kind === input.territoryKind
      && prior.country_code === (input.countryCode?.trim().toUpperCase() || null)
      && prior.subdivision_code === (input.subdivisionCode?.trim() || null)
      && prior.locality_name === (input.localityName?.trim() || null)
      && prior.external_geography_ref === (input.externalGeographyRef?.trim() || null);
    if (!exact) throw new Error('ENTERPRISE_TERRITORY_IDENTITY_CONFLICT');
    return { territory: territory(prior), idempotent: true };
  }

  const territoryId = randomUUID();
  const inserted = await client.query<TerritoryRow>(
    `INSERT INTO platform.enterprise_territories (
       territory_id, tenant_id, enterprise_id, parent_territory_id,
       territory_key, name, territory_kind, country_code, subdivision_code,
       locality_name, external_geography_ref, status, created_by_subject_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       $5, $6, $7, $8, $9, $10, $11, 'ACTIVE', $12
     )
     RETURNING ${TERRITORY_SELECT}`,
    [
      territoryId,
      input.tenantId,
      input.enterpriseId,
      input.parentTerritoryId ?? null,
      key,
      name,
      input.territoryKind,
      input.countryCode?.trim().toUpperCase() || null,
      input.subdivisionCode?.trim() || null,
      input.localityName?.trim() || null,
      input.externalGeographyRef?.trim() || null,
      input.createdBySubjectId,
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('ENTERPRISE_TERRITORY_CREATE_FAILED');

  await appendEnterpriseEvent(client, {
    tenantId: input.tenantId,
    aggregateType: 'enterprise.territory',
    aggregateId: territoryId,
    eventType: 'enterprise.territory.created',
    actorSubjectId: input.createdBySubjectId,
    correlationId: input.correlationId,
    payload: {
      enterpriseId: input.enterpriseId,
      territoryKey: key,
      territoryKind: input.territoryKind,
      parentTerritoryId: input.parentTerritoryId ?? null,
    },
  });
  return { territory: territory(row), idempotent: false };
}

export async function createEnterpriseCommercialAgreement(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly enterpriseId: string;
    readonly agreementNumber?: string | null;
    readonly title: string;
    readonly agreementKind: EnterpriseCommercialAgreementKind;
    readonly grantorLegalEntityId: string;
    readonly granteeLegalEntityId: string;
    readonly sponsoringOrganizationId: string;
    readonly governingLawCountryCode?: string | null;
    readonly governingLawSubdivisionCode?: string | null;
    readonly effectiveFrom?: string | null;
    readonly effectiveUntil?: string | null;
    readonly idempotencyKey: string;
    readonly createdBySubjectId: string;
    readonly correlationId: string;
  },
): Promise<{ readonly agreement: EnterpriseCommercialAgreement; readonly idempotent: boolean }> {
  const title = input.title.trim();
  const key = input.idempotencyKey.trim();
  if (!title || !key) throw new Error('ENTERPRISE_COMMERCIAL_AGREEMENT_INPUT_REQUIRED');

  const existing = await client.query<AgreementRow>(
    `SELECT ${AGREEMENT_SELECT}
       FROM platform.enterprise_commercial_agreements
      WHERE tenant_id = $1::uuid
        AND idempotency_key = $2
      LIMIT 1`,
    [input.tenantId, key],
  );
  const prior = existing.rows[0];
  if (prior) {
    const exact =
      prior.enterprise_id === input.enterpriseId
      && prior.agreement_number === (input.agreementNumber?.trim() || null)
      && prior.title === title
      && prior.agreement_kind === input.agreementKind
      && prior.grantor_legal_entity_id === input.grantorLegalEntityId
      && prior.grantee_legal_entity_id === input.granteeLegalEntityId
      && prior.sponsoring_organization_id === input.sponsoringOrganizationId
      && nullableIso(prior.effective_from) === (
        input.effectiveFrom == null ? null : iso(input.effectiveFrom)
      )
      && nullableIso(prior.effective_until) === (
        input.effectiveUntil == null ? null : iso(input.effectiveUntil)
      );
    if (!exact) throw new Error('ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT');
    return { agreement: agreement(prior), idempotent: true };
  }

  const agreementId = randomUUID();
  const inserted = await client.query<AgreementRow>(
    `INSERT INTO platform.enterprise_commercial_agreements (
       enterprise_commercial_agreement_id, tenant_id, enterprise_id,
       agreement_number, title, agreement_kind, grantor_legal_entity_id,
       grantee_legal_entity_id, sponsoring_organization_id, state,
       effective_from, effective_until, governing_law_country_code,
       governing_law_subdivision_code, idempotency_key, created_by_subject_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid,
       $8::uuid, $9::uuid, 'DRAFT', $10::timestamptz, $11::timestamptz,
       $12, $13, $14, $15
     )
     RETURNING ${AGREEMENT_SELECT}`,
    [
      agreementId,
      input.tenantId,
      input.enterpriseId,
      input.agreementNumber?.trim() || null,
      title,
      input.agreementKind,
      input.grantorLegalEntityId,
      input.granteeLegalEntityId,
      input.sponsoringOrganizationId,
      input.effectiveFrom ?? null,
      input.effectiveUntil ?? null,
      input.governingLawCountryCode?.trim().toUpperCase() || null,
      input.governingLawSubdivisionCode?.trim() || null,
      key,
      input.createdBySubjectId,
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('ENTERPRISE_COMMERCIAL_AGREEMENT_CREATE_FAILED');

  await appendEnterpriseEvent(client, {
    tenantId: input.tenantId,
    aggregateType: 'enterprise.commercial-agreement',
    aggregateId: agreementId,
    eventType: 'enterprise.commercial_agreement.created',
    actorSubjectId: input.createdBySubjectId,
    correlationId: input.correlationId,
    payload: {
      enterpriseId: input.enterpriseId,
      agreementKind: input.agreementKind,
      grantorLegalEntityId: input.grantorLegalEntityId,
      granteeLegalEntityId: input.granteeLegalEntityId,
    },
  });
  return { agreement: agreement(row), idempotent: false };
}

export async function approveEnterpriseCommercialAgreement(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly agreementId: string;
    readonly approvedBySubjectId: string;
    readonly reason?: string | null;
    readonly correlationId: string;
  },
): Promise<EnterpriseCommercialAgreement> {
  const current = await loadAgreement(client, input.tenantId, input.agreementId, true);
  if (current.state === 'APPROVED' || current.state === 'ACTIVE') return current;
  if (!['DRAFT','UNDER_REVIEW'].includes(current.state)) {
    throw new Error('ENTERPRISE_COMMERCIAL_AGREEMENT_NOT_APPROVABLE');
  }
  const creator = await client.query<{ readonly created_by_subject_id: string }>(
    `SELECT created_by_subject_id
       FROM platform.enterprise_commercial_agreements
      WHERE tenant_id = $1::uuid
        AND enterprise_commercial_agreement_id = $2::uuid`,
    [input.tenantId, input.agreementId],
  );
  if (creator.rows[0]?.created_by_subject_id === input.approvedBySubjectId) {
    throw new Error('ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED');
  }

  const result = await client.query<AgreementRow>(
    `UPDATE platform.enterprise_commercial_agreements
        SET state = 'APPROVED',
            approved_by_subject_id = $3,
            approved_at = now(),
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_commercial_agreement_id = $2::uuid
      RETURNING ${AGREEMENT_SELECT}`,
    [input.tenantId, input.agreementId, input.approvedBySubjectId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('ENTERPRISE_COMMERCIAL_AGREEMENT_UPDATE_FAILED');
  await appendEnterpriseEvent(client, {
    tenantId: input.tenantId,
    aggregateType: 'enterprise.commercial-agreement',
    aggregateId: input.agreementId,
    eventType: 'enterprise.commercial_agreement.approved',
    actorSubjectId: input.approvedBySubjectId,
    correlationId: input.correlationId,
    payload: { reason: input.reason?.trim() || null },
  });
  return agreement(row);
}

export async function activateEnterpriseCommercialAgreement(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly agreementId: string;
    readonly activatedBySubjectId: string;
    readonly evidenceRefs: readonly string[];
    readonly effectiveFrom?: string | null;
    readonly correlationId: string;
  },
): Promise<EnterpriseCommercialAgreement> {
  const current = await loadAgreement(client, input.tenantId, input.agreementId, true);
  if (current.state === 'ACTIVE') return current;
  if (current.state !== 'APPROVED') {
    throw new Error('ENTERPRISE_COMMERCIAL_AGREEMENT_NOT_ACTIVATABLE');
  }
  const evidence = canonicalStrings(input.evidenceRefs);
  if (evidence.length === 0) {
    throw new Error('ENTERPRISE_COMMERCIAL_AGREEMENT_EXECUTION_EVIDENCE_REQUIRED');
  }

  const result = await client.query<AgreementRow>(
    `UPDATE platform.enterprise_commercial_agreements
        SET state = 'ACTIVE',
            execution_evidence_refs = $3::text[],
            effective_from = COALESCE(effective_from, $4::timestamptz, now()),
            activated_at = now(),
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_commercial_agreement_id = $2::uuid
      RETURNING ${AGREEMENT_SELECT}`,
    [
      input.tenantId,
      input.agreementId,
      evidence,
      input.effectiveFrom ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('ENTERPRISE_COMMERCIAL_AGREEMENT_UPDATE_FAILED');
  await appendEnterpriseEvent(client, {
    tenantId: input.tenantId,
    aggregateType: 'enterprise.commercial-agreement',
    aggregateId: input.agreementId,
    eventType: 'enterprise.commercial_agreement.activated',
    actorSubjectId: input.activatedBySubjectId,
    correlationId: input.correlationId,
    payload: { evidenceRefs: evidence },
  });
  return agreement(row);
}

export async function createEnterpriseAppointmentDraft(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly enterpriseId: string;
    readonly agreementId: string;
    readonly grantorOrganizationId: string;
    readonly beneficiaryOrganizationId: string;
    readonly beneficiaryLegalEntityId: string;
    readonly appointmentKind: EnterpriseAppointmentKind;
    readonly requestedRightTypes: readonly string[];
    readonly territoryIds: readonly string[];
    readonly exclusiveTerritoryIds?: readonly string[];
    readonly exclusivityKey?: string | null;
    readonly delegationRequested?: boolean;
    readonly subAppointmentRequested?: boolean;
    readonly channelKeys?: readonly string[];
    readonly productKeys?: readonly string[];
    readonly effectiveFrom?: string | null;
    readonly effectiveUntil?: string | null;
    readonly idempotencyKey: string;
    readonly requestedBySubjectId: string;
    readonly correlationId: string;
  },
): Promise<{ readonly appointment: EnterpriseAppointment; readonly idempotent: boolean }> {
  const key = input.idempotencyKey.trim();
  if (!key) throw new Error('ENTERPRISE_APPOINTMENT_IDEMPOTENCY_REQUIRED');
  const policy = appointmentPolicy(input.appointmentKind);
  const requestedRights = canonicalStrings(input.requestedRightTypes);
  if (requestedRights.length === 0) throw new Error('ENTERPRISE_APPOINTMENT_RIGHTS_REQUIRED');
  const allowed = new Set(policy.rightTypes);
  if (requestedRights.some((right) => !allowed.has(right))) {
    throw new Error('ENTERPRISE_APPOINTMENT_RIGHT_NOT_ALLOWED');
  }
  if ((input.delegationRequested ?? false) && !policy.delegation) {
    throw new Error('ENTERPRISE_APPOINTMENT_DELEGATION_NOT_ALLOWED');
  }
  if ((input.subAppointmentRequested ?? false) && !policy.subAppointment) {
    throw new Error('ENTERPRISE_APPOINTMENT_SUB_APPOINTMENT_NOT_ALLOWED');
  }

  const territoryIds = canonicalStrings(input.territoryIds);
  if (territoryIds.length === 0) throw new Error('ENTERPRISE_APPOINTMENT_TERRITORY_REQUIRED');
  const exclusive = new Set(canonicalStrings(input.exclusiveTerritoryIds ?? []));
  if ([...exclusive].some((territoryId) => !territoryIds.includes(territoryId))) {
    throw new Error('ENTERPRISE_APPOINTMENT_EXCLUSIVE_SCOPE_INVALID');
  }

  const existing = await client.query<AppointmentRow>(
    `SELECT ${APPOINTMENT_SELECT}
       FROM platform.enterprise_appointments
      WHERE tenant_id = $1::uuid
        AND idempotency_key = $2
      LIMIT 1`,
    [input.tenantId, key],
  );
  const prior = existing.rows[0];
  if (prior) {
    const priorTerritories = await listAppointmentTerritoryIds(
      client,
      input.tenantId,
      prior.enterprise_appointment_id,
    );
    const exact =
      prior.enterprise_id === input.enterpriseId
      && prior.enterprise_commercial_agreement_id === input.agreementId
      && prior.grantor_organization_id === input.grantorOrganizationId
      && prior.beneficiary_organization_id === input.beneficiaryOrganizationId
      && prior.beneficiary_legal_entity_id === input.beneficiaryLegalEntityId
      && prior.appointment_kind === input.appointmentKind
      && JSON.stringify(canonicalStrings(prior.requested_right_types))
        === JSON.stringify(requestedRights)
      && JSON.stringify(priorTerritories.sort()) === JSON.stringify([...territoryIds].sort());
    if (!exact) throw new Error('ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT');
    return { appointment: appointment(prior), idempotent: true };
  }

  const agreementRecord = await loadAgreement(client, input.tenantId, input.agreementId);
  if (agreementRecord.enterpriseId !== input.enterpriseId) {
    throw new Error('ENTERPRISE_APPOINTMENT_AGREEMENT_SCOPE_MISMATCH');
  }
  if (!['APPROVED','ACTIVE'].includes(agreementRecord.state)) {
    throw new Error('ENTERPRISE_APPOINTMENT_AGREEMENT_NOT_APPROVED');
  }

  const appointmentId = randomUUID();
  const inserted = await client.query<AppointmentRow>(
    `INSERT INTO platform.enterprise_appointments (
       enterprise_appointment_id, tenant_id, enterprise_id,
       enterprise_commercial_agreement_id, grantor_organization_id,
       beneficiary_organization_id, beneficiary_legal_entity_id,
       appointment_kind, rights_profile_key, rights_profile_version,
       requested_right_types, exclusivity_key, delegation_requested,
       sub_appointment_requested, channel_keys, product_keys, state,
       idempotency_key, effective_from, effective_until,
       requested_by_subject_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
       $6::uuid, $7::uuid, $8, $9, 1, $10::text[], $11,
       $12, $13, $14::text[], $15::text[], 'DRAFT',
       $16, $17::timestamptz, $18::timestamptz, $19
     )
     RETURNING ${APPOINTMENT_SELECT}`,
    [
      appointmentId,
      input.tenantId,
      input.enterpriseId,
      input.agreementId,
      input.grantorOrganizationId,
      input.beneficiaryOrganizationId,
      input.beneficiaryLegalEntityId,
      input.appointmentKind,
      policy.profileKey,
      requestedRights,
      input.exclusivityKey?.trim() || null,
      input.delegationRequested ?? false,
      input.subAppointmentRequested ?? false,
      canonicalStrings(input.channelKeys ?? []),
      canonicalStrings(input.productKeys ?? []),
      key,
      input.effectiveFrom ?? null,
      input.effectiveUntil ?? null,
      input.requestedBySubjectId,
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('ENTERPRISE_APPOINTMENT_CREATE_FAILED');

  for (const territoryId of territoryIds) {
    await client.query(
      `INSERT INTO platform.enterprise_appointment_territories (
         enterprise_appointment_id, tenant_id, enterprise_id, territory_id,
         exclusive, created_by_subject_id
       )
       SELECT $1::uuid, $2::uuid, $3::uuid, territory.territory_id,
              $5, $6
         FROM platform.enterprise_territories territory
        WHERE territory.tenant_id = $2::uuid
          AND territory.enterprise_id = $3::uuid
          AND territory.territory_id = $4::uuid
          AND territory.status = 'ACTIVE'`,
      [
        appointmentId,
        input.tenantId,
        input.enterpriseId,
        territoryId,
        exclusive.has(territoryId),
        input.requestedBySubjectId,
      ],
    );
  }
  const persistedTerritories = await listAppointmentTerritoryIds(
    client,
    input.tenantId,
    appointmentId,
  );
  if (persistedTerritories.length !== territoryIds.length) {
    throw new Error('ENTERPRISE_APPOINTMENT_TERRITORY_SCOPE_INVALID');
  }

  await appendEnterpriseEvent(client, {
    tenantId: input.tenantId,
    aggregateType: 'enterprise.appointment',
    aggregateId: appointmentId,
    eventType: 'enterprise.appointment.drafted',
    actorSubjectId: input.requestedBySubjectId,
    correlationId: input.correlationId,
    payload: {
      enterpriseId: input.enterpriseId,
      appointmentKind: input.appointmentKind,
      agreementId: input.agreementId,
      territoryIds,
      requestedRightTypes: requestedRights,
    },
  });
  return { appointment: appointment(row), idempotent: false };
}

export async function submitEnterpriseAppointment(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly appointmentId: string;
    readonly workflowInstanceId: string;
    readonly submittedBySubjectId: string;
    readonly correlationId: string;
  },
): Promise<EnterpriseAppointment> {
  const current = await loadAppointment(client, input.tenantId, input.appointmentId, true);
  if (current.state === 'SUBMITTED' || current.state === 'UNDER_REVIEW') return current;
  if (current.state !== 'DRAFT') throw new Error('ENTERPRISE_APPOINTMENT_NOT_SUBMITTABLE');

  const instance = await client.query<{
    readonly subject_type: string;
    readonly subject_id: string;
    readonly work_type_key: string;
  }>(
    `SELECT subject_type, subject_id, work_type_key
       FROM platform.workflow_instances
      WHERE tenant_id = $1::uuid
        AND instance_id = $2::uuid
      LIMIT 1`,
    [input.tenantId, input.workflowInstanceId],
  );
  const workflow = instance.rows[0];
  if (
    !workflow
    || workflow.subject_type !== 'enterprise.appointment'
    || workflow.subject_id !== input.appointmentId
    || workflow.work_type_key !== 'enterprise.commercial-appointment'
  ) {
    throw new Error('ENTERPRISE_APPOINTMENT_WORKFLOW_MISMATCH');
  }

  const result = await client.query<AppointmentRow>(
    `UPDATE platform.enterprise_appointments
        SET workflow_instance_id = $3::uuid,
            state = 'SUBMITTED',
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_appointment_id = $2::uuid
      RETURNING ${APPOINTMENT_SELECT}`,
    [input.tenantId, input.appointmentId, input.workflowInstanceId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('ENTERPRISE_APPOINTMENT_UPDATE_FAILED');
  await appendEnterpriseEvent(client, {
    tenantId: input.tenantId,
    aggregateType: 'enterprise.appointment',
    aggregateId: input.appointmentId,
    eventType: 'enterprise.appointment.submitted',
    actorSubjectId: input.submittedBySubjectId,
    correlationId: input.correlationId,
    payload: { workflowInstanceId: input.workflowInstanceId },
  });
  return appointment(row);
}

export async function markEnterpriseAppointmentUnderReview(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly appointmentId: string;
    readonly actorSubjectId: string;
    readonly correlationId: string;
  },
): Promise<EnterpriseAppointment> {
  const current = await loadAppointment(client, input.tenantId, input.appointmentId, true);
  if (current.state === 'UNDER_REVIEW') return current;
  if (current.state !== 'SUBMITTED' || !current.workflowInstanceId) {
    throw new Error('ENTERPRISE_APPOINTMENT_NOT_REVIEWABLE');
  }
  const stage = await client.query<{ readonly current_stage_key: string | null }>(
    `SELECT current_stage_key
       FROM platform.workflow_instances
      WHERE tenant_id = $1::uuid
        AND instance_id = $2::uuid`,
    [input.tenantId, current.workflowInstanceId],
  );
  if (stage.rows[0]?.current_stage_key !== 'COMMERCIAL_REVIEW') {
    throw new Error('ENTERPRISE_APPOINTMENT_REVIEW_STAGE_REQUIRED');
  }
  const result = await client.query<AppointmentRow>(
    `UPDATE platform.enterprise_appointments
        SET state = 'UNDER_REVIEW', updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_appointment_id = $2::uuid
      RETURNING ${APPOINTMENT_SELECT}`,
    [input.tenantId, input.appointmentId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('ENTERPRISE_APPOINTMENT_UPDATE_FAILED');
  await appendEnterpriseEvent(client, {
    tenantId: input.tenantId,
    aggregateType: 'enterprise.appointment',
    aggregateId: input.appointmentId,
    eventType: 'enterprise.appointment.review_started',
    actorSubjectId: input.actorSubjectId,
    correlationId: input.correlationId,
    payload: { workflowInstanceId: current.workflowInstanceId },
  });
  return appointment(row);
}

export async function rejectEnterpriseAppointmentFromWorkflow(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly appointmentId: string;
    readonly rejectedBySubjectId: string;
    readonly correlationId: string;
  },
): Promise<EnterpriseAppointment> {
  const current = await loadAppointment(client, input.tenantId, input.appointmentId, true);
  if (current.state === 'REJECTED') return current;
  if (!current.workflowInstanceId) throw new Error('ENTERPRISE_APPOINTMENT_WORKFLOW_REQUIRED');
  const decision = await client.query<{
    readonly decision_id: string;
    readonly decided_by_subject_id: string;
  }>(
    `SELECT decision_id, decided_by_subject_id
       FROM platform.workflow_stage_decisions
      WHERE tenant_id = $1::uuid
        AND instance_id = $2::uuid
        AND work_type_key = 'enterprise.commercial-appointment'
        AND stage_key = 'COMMERCIAL_REVIEW'
        AND outcome = 'REJECT'
      ORDER BY decided_at DESC
      LIMIT 1`,
    [input.tenantId, current.workflowInstanceId],
  );
  const rowDecision = decision.rows[0];
  if (!rowDecision || rowDecision.decided_by_subject_id !== input.rejectedBySubjectId) {
    throw new Error('ENTERPRISE_APPOINTMENT_REJECTED_DECISION_REQUIRED');
  }
  const result = await client.query<AppointmentRow>(
    `UPDATE platform.enterprise_appointments
        SET state = 'REJECTED', updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_appointment_id = $2::uuid
      RETURNING ${APPOINTMENT_SELECT}`,
    [input.tenantId, input.appointmentId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('ENTERPRISE_APPOINTMENT_UPDATE_FAILED');
  await appendEnterpriseEvent(client, {
    tenantId: input.tenantId,
    aggregateType: 'enterprise.appointment',
    aggregateId: input.appointmentId,
    eventType: 'enterprise.appointment.rejected',
    actorSubjectId: input.rejectedBySubjectId,
    correlationId: input.correlationId,
    payload: { decisionId: rowDecision.decision_id },
  });
  return appointment(row);
}

export async function approveEnterpriseAppointmentFromWorkflow(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly appointmentId: string;
    readonly approvedBySubjectId: string;
    readonly correlationId: string;
  },
): Promise<EnterpriseAppointment> {
  const current = await loadAppointment(client, input.tenantId, input.appointmentId, true);
  if (current.state === 'APPROVED' || current.state === 'RIGHTS_PENDING' || current.state === 'ACTIVE') {
    return current;
  }
  if (!current.workflowInstanceId) throw new Error('ENTERPRISE_APPOINTMENT_WORKFLOW_REQUIRED');

  const decision = await approvedCommercialDecision(
    client,
    input.tenantId,
    current.workflowInstanceId,
  );
  if (!decision || decision.decided_by_subject_id !== input.approvedBySubjectId) {
    throw new Error('ENTERPRISE_APPOINTMENT_APPROVED_DECISION_REQUIRED');
  }
  const instance = await client.query<{ readonly current_stage_key: string | null }>(
    `SELECT current_stage_key
       FROM platform.workflow_instances
      WHERE tenant_id = $1::uuid
        AND instance_id = $2::uuid`,
    [input.tenantId, current.workflowInstanceId],
  );
  if (!['RIGHTS','ACTIVE'].includes(instance.rows[0]?.current_stage_key ?? '')) {
    throw new Error('ENTERPRISE_APPOINTMENT_RIGHTS_STAGE_REQUIRED');
  }

  const result = await client.query<AppointmentRow>(
    `UPDATE platform.enterprise_appointments
        SET state = 'APPROVED',
            approved_by_subject_id = $3,
            approved_at = COALESCE(approved_at, now()),
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_appointment_id = $2::uuid
      RETURNING ${APPOINTMENT_SELECT}`,
    [input.tenantId, input.appointmentId, input.approvedBySubjectId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('ENTERPRISE_APPOINTMENT_UPDATE_FAILED');
  await appendEnterpriseEvent(client, {
    tenantId: input.tenantId,
    aggregateType: 'enterprise.appointment',
    aggregateId: input.appointmentId,
    eventType: 'enterprise.appointment.approved',
    actorSubjectId: input.approvedBySubjectId,
    correlationId: input.correlationId,
    payload: {
      workflowInstanceId: current.workflowInstanceId,
      decisionId: decision.decision_id,
    },
  });
  return appointment(row);
}

export async function issueEnterpriseAppointmentRights(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly appointmentId: string;
    readonly issuedBySubjectId: string;
    readonly correlationId: string;
  },
): Promise<{ readonly appointment: EnterpriseAppointment; readonly grant: WorkflowRightsGrant; readonly idempotent: boolean }> {
  const current = await loadAppointment(client, input.tenantId, input.appointmentId, true);
  if (!current.workflowInstanceId) throw new Error('ENTERPRISE_APPOINTMENT_WORKFLOW_REQUIRED');
  if (current.workflowRightsGrantId) {
    const existing = await new PostgresWorkflowRightsGrantRepository(client).find({
      tenantId: input.tenantId,
      grantId: current.workflowRightsGrantId,
    });
    if (!existing) throw new Error('ENTERPRISE_APPOINTMENT_RIGHTS_GRANT_MISSING');
    return { appointment: current, grant: existing, idempotent: true };
  }
  if (current.state !== 'APPROVED') throw new Error('ENTERPRISE_APPOINTMENT_NOT_RIGHTS_READY');

  const agreementRecord = await loadAgreement(client, input.tenantId, current.agreementId);
  if (agreementRecord.state !== 'ACTIVE') {
    throw new Error('ENTERPRISE_APPOINTMENT_ACTIVE_AGREEMENT_REQUIRED');
  }
  const decision = await approvedCommercialDecision(
    client,
    input.tenantId,
    current.workflowInstanceId,
  );
  if (!decision) throw new Error('ENTERPRISE_APPOINTMENT_APPROVED_DECISION_REQUIRED');

  const stage = await client.query<{ readonly current_stage_key: string | null }>(
    `SELECT current_stage_key
       FROM platform.workflow_instances
      WHERE tenant_id = $1::uuid
        AND instance_id = $2::uuid`,
    [input.tenantId, current.workflowInstanceId],
  );
  if (stage.rows[0]?.current_stage_key !== 'RIGHTS') {
    throw new Error('ENTERPRISE_APPOINTMENT_RIGHTS_STAGE_REQUIRED');
  }

  const territoryIds = await listAppointmentTerritoryIds(
    client,
    input.tenantId,
    input.appointmentId,
  );
  const grantId = input.appointmentId;
  const grantService = new RepositoryWorkflowRightsGrantService({
    profiles: new PostgresWorkflowRightsProfileProvider(client),
    repository: new PostgresWorkflowRightsGrantRepository(client),
  });
  const result = await grantService.grant({
    tenantId: input.tenantId,
    instanceId: current.workflowInstanceId,
    workTypeKey: 'enterprise.commercial-appointment',
    grantId,
    beneficiaryOrganizationId: current.beneficiaryOrganizationId,
    profile: {
      profileKey: current.rightsProfileKey,
      version: current.rightsProfileVersion,
    },
    rightTypes: current.requestedRightTypes,
    scope: {
      territoryIds,
      ...(current.channelKeys.length === 0 ? {} : { channelKeys: current.channelKeys }),
      ...(current.productKeys.length === 0 ? {} : { productKeys: current.productKeys }),
      attributes: {
        appointmentId: current.appointmentId,
        appointmentKind: current.appointmentKind,
        delegationRequested: current.delegationRequested,
        subAppointmentRequested: current.subAppointmentRequested,
      },
    },
    ...(current.exclusivityKey === null ? {} : { exclusivityKey: current.exclusivityKey }),
    effectiveFrom: current.effectiveFrom ?? new Date().toISOString(),
    ...(current.effectiveUntil === null ? {} : { effectiveUntil: current.effectiveUntil }),
    sourceDecisionId: decision.decision_id,
    sourceAgreementId: current.agreementId,
    requestedBySubjectId: input.issuedBySubjectId,
    evidenceRefs: [
      `enterprise-agreement:${current.agreementId}`,
      `workflow-decision:${decision.decision_id}`,
      ...territoryIds.map((territoryId) => `enterprise-territory:${territoryId}`),
    ],
  });
  if (result.status === 'DENIED') throw new Error(`ENTERPRISE_RIGHTS_DENIED:${result.code}`);
  if (result.status === 'CONFLICT') throw new Error('ENTERPRISE_RIGHTS_CONFLICT');

  const updated = await client.query<AppointmentRow>(
    `UPDATE platform.enterprise_appointments
        SET workflow_rights_grant_id = $3::uuid,
            state = 'RIGHTS_PENDING',
            effective_from = COALESCE(effective_from, $4::timestamptz),
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_appointment_id = $2::uuid
      RETURNING ${APPOINTMENT_SELECT}`,
    [
      input.tenantId,
      input.appointmentId,
      result.grant.grantId,
      result.grant.effectiveFrom,
    ],
  );
  const row = updated.rows[0];
  if (!row) throw new Error('ENTERPRISE_APPOINTMENT_UPDATE_FAILED');
  await appendEnterpriseEvent(client, {
    tenantId: input.tenantId,
    aggregateType: 'enterprise.appointment',
    aggregateId: input.appointmentId,
    eventType: 'enterprise.appointment.rights_granted',
    actorSubjectId: input.issuedBySubjectId,
    correlationId: input.correlationId,
    payload: {
      workflowRightsGrantId: result.grant.grantId,
      rightTypes: result.grant.rightTypes,
      territoryIds,
    },
  });
  return {
    appointment: appointment(row),
    grant: result.grant,
    idempotent: result.status === 'ALREADY_GRANTED',
  };
}

export async function activateEnterpriseAppointment(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly appointmentId: string;
    readonly activatedBySubjectId: string;
    readonly correlationId: string;
  },
): Promise<EnterpriseAppointment> {
  const current = await loadAppointment(client, input.tenantId, input.appointmentId, true);
  if (current.state === 'ACTIVE') return current;
  if (current.state !== 'RIGHTS_PENDING' || !current.workflowInstanceId || !current.workflowRightsGrantId) {
    throw new Error('ENTERPRISE_APPOINTMENT_NOT_ACTIVATABLE');
  }
  const stage = await client.query<{ readonly current_stage_key: string | null }>(
    `SELECT current_stage_key
       FROM platform.workflow_instances
      WHERE tenant_id = $1::uuid
        AND instance_id = $2::uuid`,
    [input.tenantId, current.workflowInstanceId],
  );
  if (stage.rows[0]?.current_stage_key !== 'ACTIVE') {
    throw new Error('ENTERPRISE_APPOINTMENT_WORKFLOW_NOT_ACTIVE');
  }

  const result = await client.query<AppointmentRow>(
    `UPDATE platform.enterprise_appointments
        SET state = 'ACTIVE',
            activated_at = now(),
            effective_from = COALESCE(effective_from, now()),
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_appointment_id = $2::uuid
      RETURNING ${APPOINTMENT_SELECT}`,
    [input.tenantId, input.appointmentId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('ENTERPRISE_APPOINTMENT_UPDATE_FAILED');
  await appendEnterpriseEvent(client, {
    tenantId: input.tenantId,
    aggregateType: 'enterprise.appointment',
    aggregateId: input.appointmentId,
    eventType: 'enterprise.appointment.activated',
    actorSubjectId: input.activatedBySubjectId,
    correlationId: input.correlationId,
    payload: { workflowRightsGrantId: current.workflowRightsGrantId },
  });
  return appointment(row);
}

export async function createEnterpriseJurisdictionActivation(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly enterpriseId: string;
    readonly appointmentId: string;
    readonly organizationId: string;
    readonly territoryId: string;
    readonly idempotencyKey: string;
    readonly requestedBySubjectId: string;
    readonly correlationId: string;
  },
): Promise<{ readonly activation: EnterpriseJurisdictionActivation; readonly idempotent: boolean }> {
  const key = input.idempotencyKey.trim();
  if (!key) throw new Error('ENTERPRISE_JURISDICTION_IDEMPOTENCY_REQUIRED');
  const existing = await client.query<JurisdictionRow>(
    `SELECT ${JURISDICTION_SELECT}
       FROM platform.enterprise_jurisdiction_activations
      WHERE tenant_id = $1::uuid
        AND idempotency_key = $2
      LIMIT 1`,
    [input.tenantId, key],
  );
  const prior = existing.rows[0];
  if (prior) {
    const exact =
      prior.enterprise_id === input.enterpriseId
      && prior.enterprise_appointment_id === input.appointmentId
      && prior.organization_id === input.organizationId
      && prior.territory_id === input.territoryId;
    if (!exact) throw new Error('ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT');
    return { activation: jurisdiction(prior), idempotent: true };
  }

  const appointmentRecord = await loadAppointment(client, input.tenantId, input.appointmentId);
  if (
    appointmentRecord.state !== 'ACTIVE'
    || appointmentRecord.enterpriseId !== input.enterpriseId
    || appointmentRecord.beneficiaryOrganizationId !== input.organizationId
    || !appointmentRecord.workflowInstanceId
    || !appointmentRecord.workflowRightsGrantId
  ) {
    throw new Error('ENTERPRISE_JURISDICTION_ACTIVE_APPOINTMENT_REQUIRED');
  }
  const territories = await listAppointmentTerritoryIds(client, input.tenantId, input.appointmentId);
  if (!territories.includes(input.territoryId)) {
    throw new Error('ENTERPRISE_JURISDICTION_TERRITORY_NOT_APPOINTED');
  }

  const jurisdictionId = randomUUID();
  const inserted = await client.query<JurisdictionRow>(
    `INSERT INTO platform.enterprise_jurisdiction_activations (
       enterprise_jurisdiction_activation_id, tenant_id, enterprise_id,
       organization_id, enterprise_appointment_id, territory_id,
       idempotency_key, state, requested_by_subject_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
       $7, 'PLANNING', $8
     )
     RETURNING ${JURISDICTION_SELECT}`,
    [
      jurisdictionId,
      input.tenantId,
      input.enterpriseId,
      input.organizationId,
      input.appointmentId,
      input.territoryId,
      key,
      input.requestedBySubjectId,
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('ENTERPRISE_JURISDICTION_CREATE_FAILED');
  await appendEnterpriseEvent(client, {
    tenantId: input.tenantId,
    aggregateType: 'enterprise.jurisdiction-activation',
    aggregateId: jurisdictionId,
    eventType: 'enterprise.jurisdiction.planned',
    actorSubjectId: input.requestedBySubjectId,
    correlationId: input.correlationId,
    payload: {
      appointmentId: input.appointmentId,
      organizationId: input.organizationId,
      territoryId: input.territoryId,
    },
  });
  return { activation: jurisdiction(row), idempotent: false };
}

export async function startEnterpriseJurisdictionActivationReview(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly jurisdictionActivationId: string;
    readonly requestedBySubjectId: string;
    readonly correlationId: string;
  },
): Promise<EnterpriseJurisdictionActivation> {
  const current = await loadJurisdiction(
    client,
    input.tenantId,
    input.jurisdictionActivationId,
    true,
  );
  if (current.state === 'ACTIVATION_REVIEW' || current.state === 'APPROVED' || current.state === 'ACTIVE') {
    return current;
  }
  if (current.state !== 'PLANNING') throw new Error('ENTERPRISE_JURISDICTION_REVIEW_NOT_STARTABLE');

  const appointmentRecord = await loadAppointment(client, input.tenantId, current.appointmentId);
  if (
    appointmentRecord.state !== 'ACTIVE'
    || !appointmentRecord.workflowInstanceId
    || !appointmentRecord.workflowRightsGrantId
  ) {
    throw new Error('ENTERPRISE_JURISDICTION_ACTIVE_APPOINTMENT_REQUIRED');
  }

  const service = new RepositoryWorkflowActivationService({
    blueprints: new PostgresWorkflowActivationBlueprintProvider(client),
    rights: new PostgresWorkflowRightsGrantRepository(client),
    repository: new PostgresWorkflowActivationRepository(client),
  });
  const started = await service.activate({
    tenantId: input.tenantId,
    instanceId: appointmentRecord.workflowInstanceId,
    workTypeKey: 'enterprise.commercial-appointment',
    activationId: current.jurisdictionActivationId,
    blueprint: {
      blueprintKey: 'enterprise.jurisdiction-activation',
      version: 1,
    },
    sourceRightsGrantIds: [appointmentRecord.workflowRightsGrantId],
    requestedBySubjectId: input.requestedBySubjectId,
    requestedAt: new Date().toISOString(),
    evidenceRefs: [
      `enterprise-appointment:${current.appointmentId}`,
      `enterprise-territory:${current.territoryId}`,
      `workflow-rights-grant:${appointmentRecord.workflowRightsGrantId}`,
    ],
  });
  if (started.status === 'DENIED') throw new Error(`ENTERPRISE_ACTIVATION_DENIED:${started.code}`);
  if (started.status === 'CONFLICT') throw new Error('ENTERPRISE_ACTIVATION_CONFLICT');

  const updated = await client.query<JurisdictionRow>(
    `UPDATE platform.enterprise_jurisdiction_activations
        SET workflow_activation_id = $3::uuid,
            state = 'ACTIVATION_REVIEW',
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_jurisdiction_activation_id = $2::uuid
      RETURNING ${JURISDICTION_SELECT}`,
    [input.tenantId, current.jurisdictionActivationId, started.activation.activationId],
  );
  const row = updated.rows[0];
  if (!row) throw new Error('ENTERPRISE_JURISDICTION_UPDATE_FAILED');
  await appendEnterpriseEvent(client, {
    tenantId: input.tenantId,
    aggregateType: 'enterprise.jurisdiction-activation',
    aggregateId: current.jurisdictionActivationId,
    eventType: 'enterprise.jurisdiction.activation_review_started',
    actorSubjectId: input.requestedBySubjectId,
    correlationId: input.correlationId,
    payload: { workflowActivationId: started.activation.activationId },
  });
  return jurisdiction(row);
}

export async function verifyEnterpriseJurisdictionActivation(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly jurisdictionActivationId: string;
    readonly assessments: readonly WorkflowActivationVerificationAssessment[];
    readonly verifiedBySubjectId: string;
    readonly reason: string;
    readonly evidenceRefs: readonly string[];
    readonly correlationId: string;
  },
): Promise<{ readonly activation: EnterpriseJurisdictionActivation; readonly verified: boolean; readonly idempotent: boolean }> {
  const current = await loadJurisdiction(
    client,
    input.tenantId,
    input.jurisdictionActivationId,
    true,
  );
  if (current.state !== 'ACTIVATION_REVIEW' || !current.workflowActivationId) {
    throw new Error('ENTERPRISE_JURISDICTION_NOT_IN_ACTIVATION_REVIEW');
  }
  const appointmentRecord = await loadAppointment(client, input.tenantId, current.appointmentId);
  if (!appointmentRecord.workflowInstanceId) {
    throw new Error('ENTERPRISE_APPOINTMENT_WORKFLOW_REQUIRED');
  }

  const requiredDimensions = new Set([
    'AGREEMENT',
    'RIGHTS',
    'COMPLIANCE',
    'OPERATIONAL_READINESS',
  ]);
  const suppliedDimensions = new Set(input.assessments.map((assessment) => assessment.dimension));
  for (const dimension of requiredDimensions) {
    if (!suppliedDimensions.has(dimension as any)) {
      throw new Error('ENTERPRISE_JURISDICTION_VERIFICATION_INCOMPLETE');
    }
  }

  const repository = new PostgresWorkflowActivationVerificationRepository(client);
  const existing = await repository.find({
    tenantId: input.tenantId,
    verificationId: current.jurisdictionActivationId,
  });
  if (existing) {
    return {
      activation: current,
      verified: existing.state === 'VERIFIED',
      idempotent: true,
    };
  }

  const service = new RepositoryWorkflowActivationVerificationService({
    activations: new PostgresWorkflowActivationRepository(client),
    verifications: repository,
  });
  const result = await service.verify({
    verificationId: current.jurisdictionActivationId,
    tenantId: input.tenantId,
    instanceId: appointmentRecord.workflowInstanceId,
    activationId: current.workflowActivationId,
    assessments: input.assessments,
    verifiedBySubjectId: input.verifiedBySubjectId,
    verifiedAt: new Date().toISOString(),
    reason: input.reason.trim(),
    evidenceRefs: canonicalStrings(input.evidenceRefs),
  });
  if (result.status === 'DENIED') throw new Error(`ENTERPRISE_VERIFICATION_DENIED:${result.code}`);
  if (result.status === 'CONFLICT') throw new Error('ENTERPRISE_VERIFICATION_CONFLICT');

  await appendEnterpriseEvent(client, {
    tenantId: input.tenantId,
    aggregateType: 'enterprise.jurisdiction-activation',
    aggregateId: current.jurisdictionActivationId,
    eventType: result.verification.state === 'VERIFIED'
      ? 'enterprise.jurisdiction.verified'
      : 'enterprise.jurisdiction.verification_failed',
    actorSubjectId: input.verifiedBySubjectId,
    correlationId: input.correlationId,
    payload: {
      workflowActivationId: current.workflowActivationId,
      verificationId: result.verification.verificationId,
      state: result.verification.state,
    },
  });
  return {
    activation: current,
    verified: result.verification.state === 'VERIFIED',
    idempotent: result.status === 'ALREADY_RECORDED',
  };
}

export async function approveEnterpriseJurisdictionActivation(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly jurisdictionActivationId: string;
    readonly approvedBySubjectId: string;
    readonly reason?: string | null;
    readonly correlationId: string;
  },
): Promise<EnterpriseJurisdictionActivation> {
  const current = await loadJurisdiction(
    client,
    input.tenantId,
    input.jurisdictionActivationId,
    true,
  );
  if (current.state === 'APPROVED' || current.state === 'ACTIVE') return current;
  if (current.state !== 'ACTIVATION_REVIEW' || !current.workflowActivationId) {
    throw new Error('ENTERPRISE_JURISDICTION_NOT_APPROVABLE');
  }
  const rowMeta = await client.query<{ readonly requested_by_subject_id: string }>(
    `SELECT requested_by_subject_id
       FROM platform.enterprise_jurisdiction_activations
      WHERE tenant_id = $1::uuid
        AND enterprise_jurisdiction_activation_id = $2::uuid`,
    [input.tenantId, input.jurisdictionActivationId],
  );
  if (rowMeta.rows[0]?.requested_by_subject_id === input.approvedBySubjectId) {
    throw new Error('ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED');
  }
  const verification = await client.query<{ readonly verification_id: string }>(
    `SELECT verification_id
       FROM platform.workflow_activation_verifications
      WHERE tenant_id = $1::uuid
        AND activation_id = $2::uuid
        AND state = 'VERIFIED'
      ORDER BY verified_at DESC
      LIMIT 1`,
    [input.tenantId, current.workflowActivationId],
  );
  if (!verification.rows[0]) throw new Error('ENTERPRISE_JURISDICTION_VERIFIED_ACTIVATION_REQUIRED');

  const updated = await client.query<JurisdictionRow>(
    `UPDATE platform.enterprise_jurisdiction_activations
        SET state = 'APPROVED',
            approved_by_subject_id = $3,
            approved_at = now(),
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_jurisdiction_activation_id = $2::uuid
      RETURNING ${JURISDICTION_SELECT}`,
    [input.tenantId, input.jurisdictionActivationId, input.approvedBySubjectId],
  );
  const row = updated.rows[0];
  if (!row) throw new Error('ENTERPRISE_JURISDICTION_UPDATE_FAILED');
  await appendEnterpriseEvent(client, {
    tenantId: input.tenantId,
    aggregateType: 'enterprise.jurisdiction-activation',
    aggregateId: input.jurisdictionActivationId,
    eventType: 'enterprise.jurisdiction.approved',
    actorSubjectId: input.approvedBySubjectId,
    correlationId: input.correlationId,
    payload: {
      workflowActivationId: current.workflowActivationId,
      verificationId: verification.rows[0].verification_id,
      reason: input.reason?.trim() || null,
    },
  });
  return jurisdiction(row);
}

export async function activateEnterpriseJurisdiction(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly jurisdictionActivationId: string;
    readonly activatedBySubjectId: string;
    readonly evidenceRefs: readonly string[];
    readonly correlationId: string;
  },
): Promise<EnterpriseJurisdictionActivation> {
  const current = await loadJurisdiction(
    client,
    input.tenantId,
    input.jurisdictionActivationId,
    true,
  );
  if (current.state === 'ACTIVE') return current;
  if (current.state !== 'APPROVED' || !current.workflowActivationId) {
    throw new Error('ENTERPRISE_JURISDICTION_NOT_ACTIVATABLE');
  }
  const evidence = canonicalStrings(input.evidenceRefs);
  if (evidence.length === 0) throw new Error('ENTERPRISE_JURISDICTION_EVIDENCE_REQUIRED');

  const updated = await client.query<JurisdictionRow>(
    `UPDATE platform.enterprise_jurisdiction_activations
        SET state = 'ACTIVE',
            activated_by_subject_id = $3,
            activated_at = now(),
            evidence_refs = $4::text[],
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_jurisdiction_activation_id = $2::uuid
      RETURNING ${JURISDICTION_SELECT}`,
    [
      input.tenantId,
      input.jurisdictionActivationId,
      input.activatedBySubjectId,
      evidence,
    ],
  );
  const row = updated.rows[0];
  if (!row) throw new Error('ENTERPRISE_JURISDICTION_UPDATE_FAILED');
  await publishGovernedEntityRelationship(client, {
    tenantId: input.tenantId,
    sourceEntityType: 'OPERATING_UNIT',
    sourceEntityId: current.organizationId,
    relationshipKey: 'TERRITORIAL_JURISDICTION',
    targetEntityType: 'LOCATION',
    targetEntityId: current.territoryId,
    actorSubjectId: input.activatedBySubjectId,
    provenanceSource: 'SYSTEM',
    decisionReference: `workflow-activation:${current.workflowActivationId}`,
    attributes: {
      jurisdictionActivationId: input.jurisdictionActivationId,
      evidenceRefs: evidence,
      source: 'enterprise.jurisdiction.activation',
    },
  });

  await appendEnterpriseEvent(client, {
    tenantId: input.tenantId,
    aggregateType: 'enterprise.jurisdiction-activation',
    aggregateId: input.jurisdictionActivationId,
    eventType: 'enterprise.jurisdiction.activated',
    actorSubjectId: input.activatedBySubjectId,
    correlationId: input.correlationId,
    payload: {
      organizationId: current.organizationId,
      territoryId: current.territoryId,
      workflowActivationId: current.workflowActivationId,
      evidenceRefs: evidence,
    },
  });
  return jurisdiction(row);
}

export async function listEnterpriseCommercialPortfolio(
  client: PostgresClient,
  input: {
    readonly tenantId: string;
    readonly enterpriseId: string;
  },
): Promise<{
  readonly territories: readonly EnterpriseTerritory[];
  readonly agreements: readonly EnterpriseCommercialAgreement[];
  readonly appointments: readonly EnterpriseAppointment[];
  readonly jurisdictions: readonly EnterpriseJurisdictionActivation[];
}> {
  const territories = await client.query<TerritoryRow>(
    `SELECT ${TERRITORY_SELECT}
       FROM platform.enterprise_territories
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
      ORDER BY territory_kind, name`,
    [input.tenantId, input.enterpriseId],
  );
  const agreements = await client.query<AgreementRow>(
    `SELECT ${AGREEMENT_SELECT}
       FROM platform.enterprise_commercial_agreements
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
      ORDER BY created_at DESC`,
    [input.tenantId, input.enterpriseId],
  );
  const appointments = await client.query<AppointmentRow>(
    `SELECT ${APPOINTMENT_SELECT}
       FROM platform.enterprise_appointments
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
      ORDER BY created_at DESC`,
    [input.tenantId, input.enterpriseId],
  );
  const jurisdictions = await client.query<JurisdictionRow>(
    `SELECT ${JURISDICTION_SELECT}
       FROM platform.enterprise_jurisdiction_activations
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
      ORDER BY created_at DESC`,
    [input.tenantId, input.enterpriseId],
  );
  return {
    territories: territories.rows.map(territory),
    agreements: agreements.rows.map(agreement),
    appointments: appointments.rows.map(appointment),
    jurisdictions: jurisdictions.rows.map(jurisdiction),
  };
}

async function loadAgreement(
  client: PostgresClient,
  tenantId: string,
  agreementId: string,
  forUpdate = false,
): Promise<EnterpriseCommercialAgreement> {
  const result = await client.query<AgreementRow>(
    `SELECT ${AGREEMENT_SELECT}
       FROM platform.enterprise_commercial_agreements
      WHERE tenant_id = $1::uuid
        AND enterprise_commercial_agreement_id = $2::uuid
      LIMIT 1
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [tenantId, agreementId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('ENTERPRISE_COMMERCIAL_AGREEMENT_NOT_FOUND');
  return agreement(row);
}

async function loadAppointment(
  client: PostgresClient,
  tenantId: string,
  appointmentId: string,
  forUpdate = false,
): Promise<EnterpriseAppointment> {
  const result = await client.query<AppointmentRow>(
    `SELECT ${APPOINTMENT_SELECT}
       FROM platform.enterprise_appointments
      WHERE tenant_id = $1::uuid
        AND enterprise_appointment_id = $2::uuid
      LIMIT 1
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [tenantId, appointmentId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('ENTERPRISE_APPOINTMENT_NOT_FOUND');
  return appointment(row);
}

async function loadJurisdiction(
  client: PostgresClient,
  tenantId: string,
  jurisdictionActivationId: string,
  forUpdate = false,
): Promise<EnterpriseJurisdictionActivation> {
  const result = await client.query<JurisdictionRow>(
    `SELECT ${JURISDICTION_SELECT}
       FROM platform.enterprise_jurisdiction_activations
      WHERE tenant_id = $1::uuid
        AND enterprise_jurisdiction_activation_id = $2::uuid
      LIMIT 1
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [tenantId, jurisdictionActivationId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('ENTERPRISE_JURISDICTION_NOT_FOUND');
  return jurisdiction(row);
}

async function listAppointmentTerritoryIds(
  client: PostgresClient,
  tenantId: string,
  appointmentId: string,
): Promise<string[]> {
  const result = await client.query<{ readonly territory_id: string }>(
    `SELECT territory_id
       FROM platform.enterprise_appointment_territories
      WHERE tenant_id = $1::uuid
        AND enterprise_appointment_id = $2::uuid
      ORDER BY territory_id`,
    [tenantId, appointmentId],
  );
  return result.rows.map((row) => row.territory_id);
}

async function approvedCommercialDecision(
  client: PostgresClient,
  tenantId: string,
  instanceId: string,
): Promise<{
  readonly decision_id: string;
  readonly decided_by_subject_id: string;
} | null> {
  const result = await client.query<{
    readonly decision_id: string;
    readonly decided_by_subject_id: string;
  }>(
    `SELECT decision_id, decided_by_subject_id
       FROM platform.workflow_stage_decisions
      WHERE tenant_id = $1::uuid
        AND instance_id = $2::uuid
        AND work_type_key = 'enterprise.commercial-appointment'
        AND stage_key = 'COMMERCIAL_REVIEW'
        AND outcome = 'APPROVE'
      ORDER BY decided_at DESC
      LIMIT 1`,
    [tenantId, instanceId],
  );
  return result.rows[0] ?? null;
}
