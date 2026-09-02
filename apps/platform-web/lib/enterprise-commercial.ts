import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  RepositoryWorkflowActivationService,
  RepositoryWorkflowActivationVerificationService,
  RepositoryWorkflowRightsGrantService,
  type WorkflowActivationVerificationAssessment,
} from '@expadio/workflow';
import { PostgresWorkflowActivationRepository } from '@expadio/postgres-runtime/workflow-activation';
import { PostgresWorkflowActivationBlueprintProvider } from '@expadio/postgres-runtime/workflow-activation-blueprint';
import { PostgresWorkflowActivationVerificationRepository } from '@expadio/postgres-runtime/workflow-activation-verification';
import { PostgresWorkflowRightsGrantRepository } from '@expadio/postgres-runtime/workflow-rights';
import { PostgresWorkflowRightsProfileProvider } from '@expadio/postgres-runtime/workflow-rights-profile';
import { startWorkflow, transitionWorkflow, recordCaseDecision, makerForStage } from './workflow-runtime';

export const ENTERPRISE_APPOINTMENT_WORK_TYPE = 'enterprise.commercial-appointment';
export const ENTERPRISE_JURISDICTION_ACTIVATION_BLUEPRINT = 'enterprise.jurisdiction-activation';

export interface EnterpriseCommercialAgreementInput {
  readonly tenantId: string;
  readonly enterpriseId: string;
  readonly title: string;
  readonly agreementKind: string;
  readonly agreementNumber?: string | null;
  readonly grantorLegalEntityId: string;
  readonly granteeLegalEntityId: string;
  readonly sponsoringOrganizationId: string;
  readonly governingLawCountryCode?: string | null;
  readonly governingLawSubdivisionCode?: string | null;
  readonly createdBySubjectId: string;
}

export interface EnterpriseAppointmentInput {
  readonly tenantId: string;
  readonly enterpriseId: string;
  readonly agreementId: string;
  readonly grantorOrganizationId: string;
  readonly beneficiaryOrganizationId: string;
  readonly beneficiaryLegalEntityId: string;
  readonly appointmentKind: string;
  readonly rightsProfileKey: string;
  readonly requestedRightTypes: readonly string[];
  readonly territoryIds: readonly string[];
  readonly exclusive?: boolean;
  readonly exclusivityKey?: string | null;
  readonly delegationRequested?: boolean;
  readonly subAppointmentRequested?: boolean;
  readonly channelKeys?: readonly string[];
  readonly productKeys?: readonly string[];
  readonly effectiveFrom?: string;
  readonly effectiveUntil?: string | null;
  readonly requestedBySubjectId: string;
}

interface AppointmentRow {
  readonly enterprise_appointment_id: string;
  readonly enterprise_commercial_agreement_id: string;
  readonly enterprise_id: string;
  readonly grantor_organization_id: string;
  readonly beneficiary_organization_id: string;
  readonly beneficiary_legal_entity_id: string;
  readonly appointment_kind: string;
  readonly rights_profile_key: string;
  readonly rights_profile_version: number;
  readonly requested_right_types: readonly string[];
  readonly exclusivity_key: string | null;
  readonly channel_keys: readonly string[];
  readonly product_keys: readonly string[];
  readonly state: string;
  readonly workflow_instance_id: string | null;
  readonly workflow_rights_grant_id: string | null;
  readonly effective_from: Date | string | null;
  readonly effective_until: Date | string | null;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

async function loadAppointment(
  client: PoolClient,
  tenantId: string,
  appointmentId: string,
  forUpdate = false,
): Promise<AppointmentRow> {
  const result = await client.query<AppointmentRow>(
    `SELECT enterprise_appointment_id, enterprise_commercial_agreement_id,
            enterprise_id, grantor_organization_id, beneficiary_organization_id,
            beneficiary_legal_entity_id, appointment_kind, rights_profile_key,
            rights_profile_version, requested_right_types, exclusivity_key,
            channel_keys, product_keys, state, workflow_instance_id,
            workflow_rights_grant_id, effective_from, effective_until
       FROM platform.enterprise_appointments
      WHERE tenant_id = $1::uuid
        AND enterprise_appointment_id = $2::uuid
      LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [tenantId, appointmentId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('ENTERPRISE_APPOINTMENT_NOT_FOUND');
  return row;
}

export async function createEnterpriseCommercialAgreement(
  client: PoolClient,
  input: EnterpriseCommercialAgreementInput,
): Promise<{ readonly agreementId: string }> {
  const grantor = await client.query(
    `SELECT 1 FROM platform.legal_entities
      WHERE tenant_id = $1::uuid AND enterprise_id = $2::uuid
        AND legal_entity_id = $3::uuid AND status = 'VERIFIED'`,
    [input.tenantId, input.enterpriseId, input.grantorLegalEntityId],
  );
  const grantee = await client.query(
    `SELECT 1 FROM platform.legal_entities
      WHERE tenant_id = $1::uuid AND enterprise_id = $2::uuid
        AND legal_entity_id = $3::uuid AND status = 'VERIFIED'`,
    [input.tenantId, input.enterpriseId, input.granteeLegalEntityId],
  );
  if (grantor.rowCount !== 1 || grantee.rowCount !== 1) {
    throw new Error('ENTERPRISE_COMMERCIAL_VERIFIED_COUNTERPARTIES_REQUIRED');
  }
  const sponsor = await client.query(
    `SELECT 1 FROM platform.organizations
      WHERE tenant_id = $1::uuid AND enterprise_id = $2::uuid
        AND organization_id = $3::uuid AND status = 'ACTIVE'`,
    [input.tenantId, input.enterpriseId, input.sponsoringOrganizationId],
  );
  if (sponsor.rowCount !== 1) throw new Error('ENTERPRISE_COMMERCIAL_ACTIVE_SPONSOR_REQUIRED');

  const agreementId = randomUUID();
  await client.query(
    `INSERT INTO platform.enterprise_commercial_agreements (
       enterprise_commercial_agreement_id, tenant_id, enterprise_id,
       agreement_number, title, agreement_kind,
       grantor_legal_entity_id, grantee_legal_entity_id,
       sponsoring_organization_id, governing_law_country_code,
       governing_law_subdivision_code, created_by_subject_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
       $7::uuid, $8::uuid, $9::uuid, $10, $11, $12
     )`,
    [
      agreementId,
      input.tenantId,
      input.enterpriseId,
      input.agreementNumber?.trim() || null,
      input.title.trim(),
      input.agreementKind,
      input.grantorLegalEntityId,
      input.granteeLegalEntityId,
      input.sponsoringOrganizationId,
      input.governingLawCountryCode ?? null,
      input.governingLawSubdivisionCode ?? null,
      input.createdBySubjectId,
    ],
  );
  return { agreementId };
}

export async function approveAndActivateEnterpriseCommercialAgreement(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly agreementId: string;
    readonly approvedBySubjectId: string;
    readonly executionEvidenceRefs: readonly string[];
    readonly effectiveFrom?: string;
    readonly effectiveUntil?: string | null;
  },
): Promise<void> {
  if (input.executionEvidenceRefs.length === 0) {
    throw new Error('ENTERPRISE_COMMERCIAL_EXECUTION_EVIDENCE_REQUIRED');
  }
  const effectiveFrom = input.effectiveFrom ?? new Date().toISOString();
  const updated = await client.query(
    `UPDATE platform.enterprise_commercial_agreements
        SET state = 'ACTIVE',
            approved_by_subject_id = $3,
            approved_at = COALESCE(approved_at, now()),
            effective_from = COALESCE(effective_from, $4::timestamptz),
            effective_until = $5::timestamptz,
            execution_evidence_refs = $6::text[],
            activated_at = now(),
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_commercial_agreement_id = $2::uuid
        AND state IN ('DRAFT','UNDER_REVIEW','APPROVED')
      RETURNING enterprise_commercial_agreement_id`,
    [
      input.tenantId,
      input.agreementId,
      input.approvedBySubjectId,
      effectiveFrom,
      input.effectiveUntil ?? null,
      [...input.executionEvidenceRefs],
    ],
  );
  if (updated.rowCount !== 1) {
    const current = await client.query(
      `SELECT state FROM platform.enterprise_commercial_agreements
        WHERE tenant_id = $1::uuid
          AND enterprise_commercial_agreement_id = $2::uuid`,
      [input.tenantId, input.agreementId],
    );
    if (current.rows[0]?.state !== 'ACTIVE') {
      throw new Error('ENTERPRISE_COMMERCIAL_AGREEMENT_ACTIVATION_FAILED');
    }
  }
}

export async function createEnterpriseAppointment(
  client: PoolClient,
  input: EnterpriseAppointmentInput,
): Promise<{ readonly appointmentId: string; readonly workflowInstanceId: string }> {
  const agreement = await client.query<{
    readonly sponsoring_organization_id: string;
    readonly grantee_legal_entity_id: string;
  }>(
    `SELECT sponsoring_organization_id, grantee_legal_entity_id
       FROM platform.enterprise_commercial_agreements
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
        AND enterprise_commercial_agreement_id = $3::uuid
        AND state = 'ACTIVE'
        AND effective_from <= now()
        AND (effective_until IS NULL OR effective_until > now())`,
    [input.tenantId, input.enterpriseId, input.agreementId],
  );
  const agreementRow = agreement.rows[0];
  if (!agreementRow) throw new Error('ENTERPRISE_APPOINTMENT_ACTIVE_AGREEMENT_REQUIRED');
  if (agreementRow.sponsoring_organization_id !== input.grantorOrganizationId) {
    throw new Error('ENTERPRISE_APPOINTMENT_GRANTOR_NOT_AGREEMENT_SPONSOR');
  }
  if (agreementRow.grantee_legal_entity_id !== input.beneficiaryLegalEntityId) {
    throw new Error('ENTERPRISE_APPOINTMENT_BENEFICIARY_ENTITY_MISMATCH');
  }

  const beneficiary = await client.query(
    `SELECT 1
       FROM platform.organizations organization
       JOIN platform.organization_legal_entity_bindings binding
         ON binding.tenant_id = organization.tenant_id
        AND binding.organization_id = organization.organization_id
        AND binding.legal_entity_id = $4::uuid
        AND binding.binding_role = 'OPERATED_BY'
        AND binding.status = 'ACTIVE'
        AND binding.valid_from <= now()
        AND (binding.valid_until IS NULL OR binding.valid_until > now())
      WHERE organization.tenant_id = $1::uuid
        AND organization.enterprise_id = $2::uuid
        AND organization.organization_id = $3::uuid
        AND organization.status = 'ACTIVE'`,
    [
      input.tenantId,
      input.enterpriseId,
      input.beneficiaryOrganizationId,
      input.beneficiaryLegalEntityId,
    ],
  );
  if (beneficiary.rowCount !== 1) {
    throw new Error('ENTERPRISE_APPOINTMENT_BENEFICIARY_OPERATING_ENTITY_REQUIRED');
  }

  const legalEntity = await client.query(
    `SELECT 1
       FROM platform.legal_entities
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
        AND legal_entity_id = $3::uuid
        AND status = 'VERIFIED'`,
    [input.tenantId, input.enterpriseId, input.beneficiaryLegalEntityId],
  );
  if (legalEntity.rowCount !== 1) throw new Error('ENTERPRISE_APPOINTMENT_VERIFIED_ENTITY_REQUIRED');

  const territoryCheck = await client.query<{ readonly territory_id: string }>(
    `SELECT territory_id
       FROM platform.enterprise_territories
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
        AND territory_id = ANY($3::uuid[])
        AND status = 'ACTIVE'`,
    [input.tenantId, input.enterpriseId, [...input.territoryIds]],
  );
  if (territoryCheck.rows.length !== new Set(input.territoryIds).size || input.territoryIds.length === 0) {
    throw new Error('ENTERPRISE_APPOINTMENT_TERRITORY_INVALID');
  }

  const appointmentId = randomUUID();
  await client.query(
    `INSERT INTO platform.enterprise_appointments (
       enterprise_appointment_id, tenant_id, enterprise_id,
       enterprise_commercial_agreement_id, grantor_organization_id,
       beneficiary_organization_id, beneficiary_legal_entity_id,
       appointment_kind, rights_profile_key, requested_right_types,
       exclusivity_key, delegation_requested, sub_appointment_requested,
       channel_keys, product_keys, state, effective_from, effective_until,
       requested_by_subject_id
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
       $6::uuid, $7::uuid, $8, $9, $10::text[],
       $11, $12, $13, $14::text[], $15::text[], 'SUBMITTED',
       $16::timestamptz, $17::timestamptz, $18
     )`,
    [
      appointmentId,
      input.tenantId,
      input.enterpriseId,
      input.agreementId,
      input.grantorOrganizationId,
      input.beneficiaryOrganizationId,
      input.beneficiaryLegalEntityId,
      input.appointmentKind,
      input.rightsProfileKey,
      [...input.requestedRightTypes],
      input.exclusivityKey?.trim() || null,
      input.delegationRequested ?? false,
      input.subAppointmentRequested ?? false,
      [...(input.channelKeys ?? [])],
      [...(input.productKeys ?? [])],
      input.effectiveFrom ?? new Date().toISOString(),
      input.effectiveUntil ?? null,
      input.requestedBySubjectId,
    ],
  );
  for (const territoryId of new Set(input.territoryIds)) {
    await client.query(
      `INSERT INTO platform.enterprise_appointment_territories (
         enterprise_appointment_id, tenant_id, enterprise_id, territory_id,
         exclusive, created_by_subject_id
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6)`,
      [
        appointmentId,
        input.tenantId,
        input.enterpriseId,
        territoryId,
        input.exclusive ?? false,
        input.requestedBySubjectId,
      ],
    );
  }

  const started = await startWorkflow(client, {
    tenantId: input.tenantId,
    subjectType: ENTERPRISE_APPOINTMENT_WORK_TYPE,
    subjectId: appointmentId,
    blueprintKey: ENTERPRISE_APPOINTMENT_WORK_TYPE,
  });
  if (!started.ok) throw new Error('ENTERPRISE_APPOINTMENT_WORKFLOW_NOT_AVAILABLE');

  await client.query(
    `UPDATE platform.enterprise_appointments
        SET workflow_instance_id = $3::uuid,
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_appointment_id = $2::uuid`,
    [input.tenantId, appointmentId, started.instance.instanceId],
  );

  return { appointmentId, workflowInstanceId: started.instance.instanceId };
}

export async function moveEnterpriseAppointmentToReview(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly appointmentId: string;
    readonly actorSubjectId: string;
  },
): Promise<void> {
  const appointment = await loadAppointment(client, input.tenantId, input.appointmentId, true);
  if (!appointment.workflow_instance_id) throw new Error('ENTERPRISE_APPOINTMENT_WORKFLOW_REQUIRED');

  const instance = await client.query<{ readonly revision: number; readonly current_stage_key: string }>(
    `SELECT revision, current_stage_key
       FROM platform.workflow_instances
      WHERE tenant_id = $1::uuid AND instance_id = $2::uuid
      FOR UPDATE`,
    [input.tenantId, appointment.workflow_instance_id],
  );
  const row = instance.rows[0];
  if (!row) throw new Error('ENTERPRISE_APPOINTMENT_WORKFLOW_REQUIRED');
  if (row.current_stage_key === 'COMMERCIAL_REVIEW') return;

  const moved = await transitionWorkflow(client, {
    tenantId: input.tenantId,
    instanceId: appointment.workflow_instance_id,
    expectedRevision: row.revision,
    toStageKey: 'COMMERCIAL_REVIEW',
    requestedBySubjectId: input.actorSubjectId,
  });
  if (!moved.ok) throw new Error(`ENTERPRISE_APPOINTMENT_REVIEW_TRANSITION_${moved.reason}`);

  await client.query(
    `UPDATE platform.enterprise_appointments
        SET state = 'UNDER_REVIEW', updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_appointment_id = $2::uuid`,
    [input.tenantId, input.appointmentId],
  );
}

export async function approveEnterpriseAppointment(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly appointmentId: string;
    readonly approverSubjectId: string;
  },
): Promise<void> {
  const appointment = await loadAppointment(client, input.tenantId, input.appointmentId, true);
  if (!appointment.workflow_instance_id) throw new Error('ENTERPRISE_APPOINTMENT_WORKFLOW_REQUIRED');
  const maker = await makerForStage(client, {
    tenantId: input.tenantId,
    instanceId: appointment.workflow_instance_id,
    stageKey: 'COMMERCIAL_REVIEW',
  });
  const decision = await recordCaseDecision(client, {
    tenantId: input.tenantId,
    instanceId: appointment.workflow_instance_id,
    workTypeKey: ENTERPRISE_APPOINTMENT_WORK_TYPE,
    stageKey: 'COMMERCIAL_REVIEW',
    outcome: 'APPROVE',
    approverSubjectId: input.approverSubjectId,
    makerSubjectId: maker,
  });
  if (!decision.ok) {
    throw new Error(
      decision.reason === 'AUTHORITY_DENIED'
        ? `ENTERPRISE_APPOINTMENT_APPROVAL_DENIED:${decision.code}`
        : 'ENTERPRISE_APPOINTMENT_APPROVAL_CONFLICT',
    );
  }
  await client.query(
    `UPDATE platform.enterprise_appointments
        SET state = 'APPROVED',
            approved_by_subject_id = $3,
            approved_at = COALESCE(approved_at, now()),
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_appointment_id = $2::uuid
        AND state IN ('UNDER_REVIEW','SUBMITTED','APPROVED')`,
    [input.tenantId, input.appointmentId, input.approverSubjectId],
  );
}

export async function issueEnterpriseAppointmentRights(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly appointmentId: string;
    readonly actorSubjectId: string;
    readonly grantId?: string;
    readonly evidenceRefs: readonly string[];
  },
): Promise<{ readonly grantId: string }> {
  const appointment = await loadAppointment(client, input.tenantId, input.appointmentId, true);
  if (appointment.state !== 'APPROVED' && appointment.state !== 'RIGHTS_PENDING' && appointment.state !== 'ACTIVE') {
    throw new Error('ENTERPRISE_APPOINTMENT_APPROVAL_REQUIRED');
  }
  if (!appointment.workflow_instance_id) throw new Error('ENTERPRISE_APPOINTMENT_WORKFLOW_REQUIRED');
  if (appointment.workflow_rights_grant_id) {
    return { grantId: appointment.workflow_rights_grant_id };
  }

  const territories = await client.query<{ readonly territory_id: string; readonly exclusive: boolean }>(
    `SELECT territory_id, exclusive
       FROM platform.enterprise_appointment_territories
      WHERE tenant_id = $1::uuid
        AND enterprise_appointment_id = $2::uuid
      ORDER BY territory_id`,
    [input.tenantId, input.appointmentId],
  );
  if (territories.rows.length === 0) throw new Error('ENTERPRISE_APPOINTMENT_TERRITORY_REQUIRED');

  const profileProvider = new PostgresWorkflowRightsProfileProvider(client);
  const profile = await profileProvider.resolve({
    tenantId: input.tenantId,
    profileKey: appointment.rights_profile_key,
    version: appointment.rights_profile_version,
  });
  if (!profile) throw new Error('ENTERPRISE_RIGHTS_PROFILE_NOT_FOUND');
  const flags = await client.query<{
    readonly delegation_requested: boolean;
    readonly sub_appointment_requested: boolean;
  }>(
    `SELECT delegation_requested, sub_appointment_requested
       FROM platform.enterprise_appointments
      WHERE tenant_id = $1::uuid
        AND enterprise_appointment_id = $2::uuid`,
    [input.tenantId, input.appointmentId],
  );
  const requestedFlags = flags.rows[0];
  if (requestedFlags?.delegation_requested && !profile.permitsDelegation) {
    throw new Error('ENTERPRISE_RIGHTS_DELEGATION_NOT_PERMITTED');
  }
  if (requestedFlags?.sub_appointment_requested && !profile.permitsSubAppointment) {
    throw new Error('ENTERPRISE_RIGHTS_SUB_APPOINTMENT_NOT_PERMITTED');
  }

  const grantId = input.grantId ?? randomUUID();
  const service = new RepositoryWorkflowRightsGrantService({
    profiles: profileProvider,
    repository: new PostgresWorkflowRightsGrantRepository(client),
  });
  const result = await service.grant({
    tenantId: input.tenantId,
    instanceId: appointment.workflow_instance_id,
    workTypeKey: ENTERPRISE_APPOINTMENT_WORK_TYPE,
    grantId,
    beneficiaryOrganizationId: appointment.beneficiary_organization_id,
    profile: {
      profileKey: appointment.rights_profile_key,
      version: appointment.rights_profile_version,
    },
    rightTypes: [...appointment.requested_right_types],
    scope: {
      territoryIds: territories.rows.map((row) => row.territory_id),
      ...(appointment.channel_keys.length === 0 ? {} : { channelKeys: [...appointment.channel_keys] }),
      ...(appointment.product_keys.length === 0 ? {} : { productKeys: [...appointment.product_keys] }),
    },
    ...(appointment.exclusivity_key === null ? {} : { exclusivityKey: appointment.exclusivity_key }),
    effectiveFrom: appointment.effective_from ? iso(appointment.effective_from) : new Date().toISOString(),
    ...(appointment.effective_until === null ? {} : { effectiveUntil: iso(appointment.effective_until) }),
    sourceAgreementId: appointment.enterprise_commercial_agreement_id,
    requestedBySubjectId: input.actorSubjectId,
    evidenceRefs: [...input.evidenceRefs],
  });
  if (result.status === 'DENIED') throw new Error(`ENTERPRISE_RIGHTS_DENIED:${result.code}`);
  if (result.status === 'CONFLICT') throw new Error('ENTERPRISE_RIGHTS_CONFLICT');

  await client.query(
    `UPDATE platform.enterprise_appointments
        SET workflow_rights_grant_id = $3::uuid,
            state = 'ACTIVE',
            activated_at = COALESCE(activated_at, now()),
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_appointment_id = $2::uuid`,
    [input.tenantId, input.appointmentId, result.grant.grantId],
  );

  return { grantId: result.grant.grantId };
}

export async function startEnterpriseJurisdictionActivation(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly enterpriseId: string;
    readonly appointmentId: string;
    readonly territoryId: string;
    readonly requestedBySubjectId: string;
    readonly activationId?: string;
    readonly evidenceRefs: readonly string[];
  },
): Promise<{
  readonly jurisdictionActivationId: string;
  readonly workflowActivationId: string;
}> {
  const appointment = await loadAppointment(client, input.tenantId, input.appointmentId, true);
  if (appointment.enterprise_id !== input.enterpriseId || appointment.state !== 'ACTIVE') {
    throw new Error('ENTERPRISE_JURISDICTION_ACTIVE_APPOINTMENT_REQUIRED');
  }
  if (!appointment.workflow_instance_id || !appointment.workflow_rights_grant_id) {
    throw new Error('ENTERPRISE_JURISDICTION_RIGHTS_REQUIRED');
  }
  const scope = await client.query(
    `SELECT 1 FROM platform.enterprise_appointment_territories
      WHERE tenant_id = $1::uuid
        AND enterprise_appointment_id = $2::uuid
        AND territory_id = $3::uuid`,
    [input.tenantId, input.appointmentId, input.territoryId],
  );
  if (scope.rowCount !== 1) throw new Error('ENTERPRISE_JURISDICTION_TERRITORY_NOT_APPOINTED');

  const activationId = input.activationId ?? randomUUID();
  const activationService = new RepositoryWorkflowActivationService({
    blueprints: new PostgresWorkflowActivationBlueprintProvider(client),
    rights: new PostgresWorkflowRightsGrantRepository(client),
    repository: new PostgresWorkflowActivationRepository(client),
  });
  const activation = await activationService.activate({
    tenantId: input.tenantId,
    instanceId: appointment.workflow_instance_id,
    workTypeKey: ENTERPRISE_APPOINTMENT_WORK_TYPE,
    activationId,
    blueprint: {
      blueprintKey: ENTERPRISE_JURISDICTION_ACTIVATION_BLUEPRINT,
      version: 1,
    },
    sourceRightsGrantIds: [appointment.workflow_rights_grant_id],
    requestedBySubjectId: input.requestedBySubjectId,
    requestedAt: new Date().toISOString(),
    evidenceRefs: [...input.evidenceRefs],
  });
  if (activation.status === 'DENIED') throw new Error(`ENTERPRISE_ACTIVATION_DENIED:${activation.code}`);
  if (activation.status === 'CONFLICT') throw new Error('ENTERPRISE_ACTIVATION_CONFLICT');

  const existing = await client.query<{ readonly enterprise_jurisdiction_activation_id: string }>(
    `SELECT enterprise_jurisdiction_activation_id
       FROM platform.enterprise_jurisdiction_activations
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
        AND enterprise_appointment_id = $3::uuid
        AND territory_id = $4::uuid
        AND state IN ('PLANNING','ACTIVATION_REVIEW','APPROVED','ACTIVE')
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [
      input.tenantId,
      appointment.beneficiary_organization_id,
      input.appointmentId,
      input.territoryId,
    ],
  );
  const prior = existing.rows[0];
  if (prior) {
    await client.query(
      `UPDATE platform.enterprise_jurisdiction_activations
          SET workflow_activation_id = $3::uuid,
              state = CASE WHEN state = 'PLANNING' THEN 'ACTIVATION_REVIEW' ELSE state END,
              updated_at = now()
        WHERE tenant_id = $1::uuid
          AND enterprise_jurisdiction_activation_id = $2::uuid`,
      [input.tenantId, prior.enterprise_jurisdiction_activation_id, activation.activation.activationId],
    );
    return {
      jurisdictionActivationId: prior.enterprise_jurisdiction_activation_id,
      workflowActivationId: activation.activation.activationId,
    };
  }

  const jurisdictionActivationId = randomUUID();
  await client.query(
    `INSERT INTO platform.enterprise_jurisdiction_activations (
       enterprise_jurisdiction_activation_id, tenant_id, enterprise_id,
       organization_id, enterprise_appointment_id, territory_id,
       workflow_activation_id, state, requested_by_subject_id, evidence_refs
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
       $7::uuid, 'ACTIVATION_REVIEW', $8, $9::text[]
     )`,
    [
      jurisdictionActivationId,
      input.tenantId,
      input.enterpriseId,
      appointment.beneficiary_organization_id,
      input.appointmentId,
      input.territoryId,
      activation.activation.activationId,
      input.requestedBySubjectId,
      [...input.evidenceRefs],
    ],
  );

  return {
    jurisdictionActivationId,
    workflowActivationId: activation.activation.activationId,
  };
}

export async function verifyAndActivateEnterpriseJurisdiction(
  client: PoolClient,
  input: {
    readonly tenantId: string;
    readonly jurisdictionActivationId: string;
    readonly verifiedBySubjectId: string;
    readonly reason: string;
    readonly assessments: readonly WorkflowActivationVerificationAssessment[];
    readonly evidenceRefs: readonly string[];
    readonly verificationId?: string;
  },
): Promise<void> {
  const jurisdiction = await client.query<{
    readonly enterprise_appointment_id: string;
    readonly workflow_activation_id: string | null;
    readonly state: string;
  }>(
    `SELECT enterprise_appointment_id, workflow_activation_id, state
       FROM platform.enterprise_jurisdiction_activations
      WHERE tenant_id = $1::uuid
        AND enterprise_jurisdiction_activation_id = $2::uuid
      LIMIT 1
      FOR UPDATE`,
    [input.tenantId, input.jurisdictionActivationId],
  );
  const row = jurisdiction.rows[0];
  if (!row) throw new Error('ENTERPRISE_JURISDICTION_ACTIVATION_NOT_FOUND');
  if (row.state === 'ACTIVE') return;
  if (!row.workflow_activation_id) throw new Error('ENTERPRISE_JURISDICTION_WORKFLOW_ACTIVATION_REQUIRED');

  const appointment = await loadAppointment(client, input.tenantId, row.enterprise_appointment_id, true);
  if (!appointment.workflow_instance_id) throw new Error('ENTERPRISE_APPOINTMENT_WORKFLOW_REQUIRED');

  const verificationService = new RepositoryWorkflowActivationVerificationService({
    activations: new PostgresWorkflowActivationRepository(client),
    verifications: new PostgresWorkflowActivationVerificationRepository(client),
  });
  const verified = await verificationService.verify({
    verificationId: input.verificationId ?? randomUUID(),
    tenantId: input.tenantId,
    instanceId: appointment.workflow_instance_id,
    activationId: row.workflow_activation_id,
    assessments: input.assessments.map((assessment) => ({
      ...assessment,
      evidenceRefs: [...assessment.evidenceRefs],
    })),
    verifiedBySubjectId: input.verifiedBySubjectId,
    verifiedAt: new Date().toISOString(),
    reason: input.reason.trim(),
    evidenceRefs: [...input.evidenceRefs],
  });
  if (verified.status === 'DENIED') throw new Error(`ENTERPRISE_VERIFICATION_DENIED:${verified.code}`);
  if (verified.status === 'CONFLICT') throw new Error('ENTERPRISE_VERIFICATION_CONFLICT');
  if (verified.verification.state !== 'VERIFIED') throw new Error('ENTERPRISE_JURISDICTION_VERIFICATION_FAILED');

  await client.query(
    `UPDATE platform.enterprise_jurisdiction_activations
        SET state = 'ACTIVE',
            approved_by_subject_id = COALESCE(approved_by_subject_id, $3),
            approved_at = COALESCE(approved_at, now()),
            activated_by_subject_id = $3,
            activated_at = now(),
            evidence_refs = $4::text[],
            updated_at = now()
      WHERE tenant_id = $1::uuid
        AND enterprise_jurisdiction_activation_id = $2::uuid
        AND state IN ('ACTIVATION_REVIEW','APPROVED')`,
    [
      input.tenantId,
      input.jurisdictionActivationId,
      input.verifiedBySubjectId,
      [...input.evidenceRefs],
    ],
  );
}
