import type { PoolClient } from 'pg';
import {
  findOrganizationSetupPlan,
  listOrganizationOperatingEntities,
  listOrganizationSetupParticipants,
  listOrganizationSetupRequirements,
  listVerifiedEnterpriseLegalEntities,
} from '@expadio/postgres-runtime/enterprise-onboarding';
import type { BrandContext } from './brand-context';

export async function loadBrandOnboardingPortfolio(
  client: PoolClient,
  context: BrandContext,
) {
  const enterprise = await client.query<{ enterprise_id: string }>(
    `SELECT enterprise_id
       FROM platform.organizations
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
      LIMIT 1`,
    [context.tenantId, context.organizationId],
  );
  const enterpriseId = enterprise.rows[0]?.enterprise_id;
  if (!enterpriseId) throw new Error('BRAND_ENTERPRISE_CONTEXT_NOT_FOUND');

  const requests = await client.query<{
    enterprise_change_request_id: string;
    operation: string;
    requesting_organization_id: string;
    approving_organization_id: string;
    target_organization_id: string | null;
    status: string;
    proposed_payload: Record<string, unknown>;
    requested_by_subject_id: string;
    requested_at: Date | string;
    decided_by_subject_id: string | null;
    decided_at: Date | string | null;
    decision_reason: string | null;
  }>(
    `SELECT
       request.enterprise_change_request_id,
       request.operation,
       request.requesting_organization_id,
       request.approving_organization_id,
       request.target_organization_id,
       request.status,
       request.proposed_payload,
       request.requested_by_subject_id,
       request.requested_at,
       request.decided_by_subject_id,
       request.decided_at,
       request.decision_reason
     FROM platform.enterprise_change_requests request
     WHERE request.tenant_id = $1::uuid
       AND request.enterprise_id = $2::uuid
       AND request.operation = 'CREATE_ORGANIZATION'
       AND (
         request.requesting_organization_id = $3::uuid
         OR request.approving_organization_id = $3::uuid
         OR request.target_organization_id IN (
           SELECT closure.descendant_organization_id
             FROM platform.organization_closure closure
            WHERE closure.tenant_id = $1::uuid
              AND closure.ancestor_organization_id = $3::uuid
         )
       )
     ORDER BY request.requested_at DESC, request.enterprise_change_request_id DESC`,
    [context.tenantId, enterpriseId, context.organizationId],
  );

  const plans = await client.query<{
    setup_plan_id: string;
    organization_id: string;
    organization_name: string;
    organization_kind: string;
    state: string;
    completion_percent: string | number;
    blocking_open_requirements: string | number;
    primary_administrator_subject_id: string | null;
  }>(
    `SELECT
       plan.setup_plan_id,
       plan.organization_id,
       organization.name AS organization_name,
       organization.organization_kind,
       plan.state,
       plan.completion_percent,
       plan.blocking_open_requirements,
       plan.primary_administrator_subject_id
     FROM platform.organization_setup_plans plan
     JOIN platform.organizations organization
       ON organization.tenant_id = plan.tenant_id
      AND organization.organization_id = plan.organization_id
     JOIN platform.organization_closure closure
       ON closure.tenant_id = plan.tenant_id
      AND closure.ancestor_organization_id = $3::uuid
      AND closure.descendant_organization_id = plan.organization_id
      AND closure.depth > 0
     WHERE plan.tenant_id = $1::uuid
       AND plan.enterprise_id = $2::uuid
       AND plan.state <> 'CANCELLED'
     ORDER BY plan.updated_at DESC, plan.setup_plan_id DESC`,
    [context.tenantId, enterpriseId, context.organizationId],
  );

  return {
    enterpriseId,
    requests: requests.rows.map((row) => ({
      requestId: row.enterprise_change_request_id,
      operation: row.operation,
      requestingOrganizationId: row.requesting_organization_id,
      approvingOrganizationId: row.approving_organization_id,
      targetOrganizationId: row.target_organization_id,
      status: row.status,
      proposedPayload: row.proposed_payload,
      requestedBySubjectId: row.requested_by_subject_id,
      requestedAt: new Date(row.requested_at).toISOString(),
      decidedBySubjectId: row.decided_by_subject_id,
      decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
      decisionReason: row.decision_reason,
    })),
    plans: plans.rows.map((row) => ({
      setupPlanId: row.setup_plan_id,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      organizationKind: row.organization_kind,
      state: row.state,
      completionPercent: Number(row.completion_percent),
      blockingOpenRequirements: Number(row.blocking_open_requirements),
      primaryAdministratorSubjectId: row.primary_administrator_subject_id,
    })),
  };
}

export async function loadBrandSetupPlan(
  client: PoolClient,
  context: BrandContext,
  setupPlanId: string,
) {
  const scope = await client.query<{
    organization_id: string;
    enterprise_id: string;
    organization_name: string;
    organization_kind: string;
  }>(
    `SELECT
       plan.organization_id,
       plan.enterprise_id,
       organization.name AS organization_name,
       organization.organization_kind
     FROM platform.organization_setup_plans plan
     JOIN platform.organizations organization
       ON organization.tenant_id = plan.tenant_id
      AND organization.organization_id = plan.organization_id
     JOIN platform.organization_closure closure
       ON closure.tenant_id = plan.tenant_id
      AND closure.ancestor_organization_id = $3::uuid
      AND closure.descendant_organization_id = plan.organization_id
      AND closure.depth > 0
     WHERE plan.tenant_id = $1::uuid
       AND plan.setup_plan_id = $2::uuid
     LIMIT 1`,
    [context.tenantId, setupPlanId, context.organizationId],
  );
  const target = scope.rows[0];
  if (!target) throw new Error('BRAND_ENTERPRISE_SETUP_SCOPE_MISMATCH');

  const plan = await findOrganizationSetupPlan(client, {
    tenantId: context.tenantId,
    organizationId: target.organization_id,
  });
  if (!plan || plan.setupPlanId !== setupPlanId) {
    throw new Error('ORGANIZATION_SETUP_PLAN_NOT_FOUND');
  }

  const requirements = await listOrganizationSetupRequirements(client, {
    tenantId: context.tenantId,
    setupPlanId,
  });
  const participants = await listOrganizationSetupParticipants(client, {
    tenantId: context.tenantId,
    setupPlanId,
  });
  const operatingEntities = await listOrganizationOperatingEntities(client, {
    tenantId: context.tenantId,
    organizationId: target.organization_id,
  });
  const verifiedLegalEntities = await listVerifiedEnterpriseLegalEntities(client, {
    tenantId: context.tenantId,
    enterpriseId: target.enterprise_id,
  });
  const legalEntities = await client.query<{
    legal_entity_id: string;
    legal_name: string;
    entity_type: string;
    jurisdiction_country_code: string;
    jurisdiction_subdivision_code: string | null;
    status: string;
    created_by_subject_id: string;
    verification_source: string | null;
  }>(
    `SELECT
       legal_entity_id, legal_name, entity_type,
       jurisdiction_country_code, jurisdiction_subdivision_code,
       status, created_by_subject_id, verification_source
     FROM platform.legal_entities
     WHERE tenant_id = $1::uuid
       AND enterprise_id = $2::uuid
       AND status <> 'INACTIVE'
     ORDER BY legal_name, legal_entity_id`,
    [context.tenantId, target.enterprise_id],
  );

  return {
    enterpriseId: target.enterprise_id,
    organizationId: target.organization_id,
    organizationName: target.organization_name,
    organizationKind: target.organization_kind,
    plan,
    requirements,
    participants,
    operatingEntities,
    verifiedLegalEntities,
    legalEntities: legalEntities.rows.map((row) => ({
      legalEntityId: row.legal_entity_id,
      legalName: row.legal_name,
      entityType: row.entity_type,
      countryCode: row.jurisdiction_country_code,
      subdivisionCode: row.jurisdiction_subdivision_code,
      status: row.status,
      createdBySubjectId: row.created_by_subject_id,
      verificationSource: row.verification_source,
    })),
  };
}
