import type { PoolClient } from 'pg';
import type { BrandContext } from './brand-context';

export interface BrandEnterpriseOrganization {
  readonly organizationId: string;
  readonly parentOrganizationId: string | null;
  readonly name: string;
  readonly organizationKind: string;
  readonly status: string;
  readonly depth: number;
  readonly setupPlanId: string | null;
  readonly setupState: string | null;
  readonly completionPercent: number | null;
  readonly blockingOpenRequirements: number | null;
}

export interface BrandEnterpriseLegalEntity {
  readonly legalEntityId: string;
  readonly parentLegalEntityId: string | null;
  readonly legalName: string;
  readonly entityType: string;
  readonly countryCode: string;
  readonly subdivisionCode: string | null;
  readonly status: string;
  readonly organizationBindings: readonly {
    readonly organizationId: string;
    readonly organizationName: string;
    readonly bindingRole: string;
  }[];
}

export interface BrandEnterpriseCommercialSummary {
  readonly activeAgreements: number;
  readonly activeAppointments: number;
  readonly activeJurisdictions: number;
  readonly agreements: readonly {
    readonly agreementId: string;
    readonly title: string;
    readonly kind: string;
    readonly state: string;
  }[];
  readonly appointments: readonly {
    readonly appointmentId: string;
    readonly beneficiaryOrganizationId: string;
    readonly beneficiaryOrganizationName: string;
    readonly kind: string;
    readonly state: string;
    readonly rights: readonly string[];
  }[];
  readonly jurisdictions: readonly {
    readonly jurisdictionActivationId: string;
    readonly organizationName: string;
    readonly territoryName: string;
    readonly state: string;
  }[];
}

export interface BrandEnterpriseView {
  readonly enterpriseId: string;
  readonly enterpriseName: string;
  readonly enterpriseMode: string;
  readonly enterpriseStatus: string;
  readonly selectedOrganizationId: string;
  readonly selectedOrganizationName: string;
  readonly selectedOrganizationKind: string;
  readonly selectedOrganizationStatus: string;
  readonly organizations: readonly BrandEnterpriseOrganization[];
  readonly legalEntities: readonly BrandEnterpriseLegalEntity[];
  readonly commercial: BrandEnterpriseCommercialSummary;
  readonly counts: {
    readonly organizations: number;
    readonly activeOrganizations: number;
    readonly configuringOrganizations: number;
    readonly readyForActivation: number;
    readonly legalEntities: number;
    readonly verifiedLegalEntities: number;
    readonly activeAgreements: number;
    readonly activeAppointments: number;
    readonly activeJurisdictions: number;
  };
}

export async function loadBrandEnterpriseView(
  client: PoolClient,
  context: BrandContext,
): Promise<BrandEnterpriseView> {
  const selected = await client.query<{
    enterprise_id: string;
    enterprise_name: string;
    enterprise_mode: string;
    enterprise_status: string;
    organization_name: string;
    organization_kind: string;
    organization_status: string;
  }>(
    `SELECT
       enterprise.enterprise_id,
       enterprise.name AS enterprise_name,
       enterprise.mode AS enterprise_mode,
       enterprise.status AS enterprise_status,
       organization.name AS organization_name,
       organization.organization_kind,
       organization.status AS organization_status
     FROM platform.organizations organization
     JOIN platform.enterprise_profiles enterprise
       ON enterprise.tenant_id = organization.tenant_id
      AND enterprise.enterprise_id = organization.enterprise_id
     WHERE organization.tenant_id = $1::uuid
       AND organization.organization_id = $2::uuid
     LIMIT 1`,
    [context.tenantId, context.organizationId],
  );
  const root = selected.rows[0];
  if (!root) throw new Error('BRAND_ENTERPRISE_CONTEXT_NOT_FOUND');

  const organizations = await client.query<{
    organization_id: string;
    parent_organization_id: string | null;
    name: string;
    organization_kind: string;
    status: string;
    depth: number;
    setup_plan_id: string | null;
    setup_state: string | null;
    completion_percent: string | number | null;
    blocking_open_requirements: string | number | null;
  }>(
    `SELECT
       organization.organization_id,
       organization.parent_organization_id,
       organization.name,
       organization.organization_kind,
       organization.status,
       closure.depth,
       setup.setup_plan_id,
       setup.state AS setup_state,
       setup.completion_percent,
       setup.blocking_open_requirements
     FROM platform.organization_closure closure
     JOIN platform.organizations organization
       ON organization.tenant_id = closure.tenant_id
      AND organization.organization_id = closure.descendant_organization_id
     LEFT JOIN platform.organization_setup_plans setup
       ON setup.tenant_id = organization.tenant_id
      AND setup.organization_id = organization.organization_id
      AND setup.state <> 'CANCELLED'
     WHERE closure.tenant_id = $1::uuid
       AND closure.ancestor_organization_id = $2::uuid
       AND organization.enterprise_id = $3::uuid
     ORDER BY closure.depth, organization.name, organization.organization_id`,
    [context.tenantId, context.organizationId, root.enterprise_id],
  );

  const accessibleOrganizationIds = organizations.rows.map((row) => row.organization_id);
  const legalEntities = await client.query<{
    legal_entity_id: string;
    parent_legal_entity_id: string | null;
    legal_name: string;
    entity_type: string;
    jurisdiction_country_code: string;
    jurisdiction_subdivision_code: string | null;
    status: string;
    bindings: Array<{
      organizationId: string;
      organizationName: string;
      bindingRole: string;
    }> | null;
  }>(
    `SELECT
       entity.legal_entity_id,
       entity.parent_legal_entity_id,
       entity.legal_name,
       entity.entity_type,
       entity.jurisdiction_country_code,
       entity.jurisdiction_subdivision_code,
       entity.status,
       COALESCE(
         jsonb_agg(
           DISTINCT jsonb_build_object(
             'organizationId', binding.organization_id,
             'organizationName', organization.name,
             'bindingRole', binding.binding_role
           )
         ) FILTER (WHERE binding.organization_id IS NOT NULL),
         '[]'::jsonb
       ) AS bindings
     FROM platform.legal_entities entity
     LEFT JOIN platform.organization_legal_entity_bindings binding
       ON binding.tenant_id = entity.tenant_id
      AND binding.legal_entity_id = entity.legal_entity_id
      AND binding.status = 'ACTIVE'
      AND binding.organization_id = ANY($3::uuid[])
     LEFT JOIN platform.organizations organization
       ON organization.tenant_id = binding.tenant_id
      AND organization.organization_id = binding.organization_id
     WHERE entity.tenant_id = $1::uuid
       AND entity.enterprise_id = $2::uuid
       AND (
         binding.organization_id = ANY($3::uuid[])
         OR EXISTS (
           SELECT 1
             FROM platform.organization_legal_entity_bindings visible_binding
            WHERE visible_binding.tenant_id = entity.tenant_id
              AND visible_binding.legal_entity_id = entity.legal_entity_id
              AND visible_binding.organization_id = ANY($3::uuid[])
              AND visible_binding.status = 'ACTIVE'
         )
       )
     GROUP BY entity.legal_entity_id
     ORDER BY entity.legal_name, entity.legal_entity_id`,
    [context.tenantId, root.enterprise_id, accessibleOrganizationIds],
  );

  const agreements = await client.query<{
    enterprise_commercial_agreement_id: string;
    title: string;
    agreement_kind: string;
    state: string;
  }>(
    `SELECT enterprise_commercial_agreement_id, title, agreement_kind, state
       FROM platform.enterprise_commercial_agreements
      WHERE tenant_id = $1::uuid
        AND enterprise_id = $2::uuid
        AND sponsoring_organization_id = ANY($3::uuid[])
      ORDER BY created_at DESC, enterprise_commercial_agreement_id DESC
      LIMIT 20`,
    [context.tenantId, root.enterprise_id, accessibleOrganizationIds],
  );

  const appointments = await client.query<{
    enterprise_appointment_id: string;
    beneficiary_organization_id: string;
    beneficiary_organization_name: string;
    appointment_kind: string;
    state: string;
    requested_right_types: string[];
  }>(
    `SELECT
       appointment.enterprise_appointment_id,
       appointment.beneficiary_organization_id,
       organization.name AS beneficiary_organization_name,
       appointment.appointment_kind,
       appointment.state,
       appointment.requested_right_types
     FROM platform.enterprise_appointments appointment
     JOIN platform.organizations organization
       ON organization.tenant_id = appointment.tenant_id
      AND organization.organization_id = appointment.beneficiary_organization_id
     WHERE appointment.tenant_id = $1::uuid
       AND appointment.enterprise_id = $2::uuid
       AND (
         appointment.grantor_organization_id = ANY($3::uuid[])
         OR appointment.beneficiary_organization_id = ANY($3::uuid[])
       )
     ORDER BY appointment.created_at DESC, appointment.enterprise_appointment_id DESC
     LIMIT 20`,
    [context.tenantId, root.enterprise_id, accessibleOrganizationIds],
  );

  const jurisdictions = await client.query<{
    enterprise_jurisdiction_activation_id: string;
    organization_name: string;
    territory_name: string;
    state: string;
  }>(
    `SELECT
       activation.enterprise_jurisdiction_activation_id,
       organization.name AS organization_name,
       territory.name AS territory_name,
       activation.state
     FROM platform.enterprise_jurisdiction_activations activation
     JOIN platform.organizations organization
       ON organization.tenant_id = activation.tenant_id
      AND organization.organization_id = activation.organization_id
     JOIN platform.enterprise_territories territory
       ON territory.tenant_id = activation.tenant_id
      AND territory.territory_id = activation.territory_id
     WHERE activation.tenant_id = $1::uuid
       AND activation.enterprise_id = $2::uuid
       AND activation.organization_id = ANY($3::uuid[])
     ORDER BY activation.created_at DESC, activation.enterprise_jurisdiction_activation_id DESC
     LIMIT 20`,
    [context.tenantId, root.enterprise_id, accessibleOrganizationIds],
  );

  const organizationItems = organizations.rows.map((row) => ({
    organizationId: row.organization_id,
    parentOrganizationId: row.parent_organization_id,
    name: row.name,
    organizationKind: row.organization_kind,
    status: row.status,
    depth: Number(row.depth),
    setupPlanId: row.setup_plan_id,
    setupState: row.setup_state,
    completionPercent: row.completion_percent === null ? null : Number(row.completion_percent),
    blockingOpenRequirements:
      row.blocking_open_requirements === null ? null : Number(row.blocking_open_requirements),
  }));

  const legalEntityItems = legalEntities.rows.map((row) => ({
    legalEntityId: row.legal_entity_id,
    parentLegalEntityId: row.parent_legal_entity_id,
    legalName: row.legal_name,
    entityType: row.entity_type,
    countryCode: row.jurisdiction_country_code,
    subdivisionCode: row.jurisdiction_subdivision_code,
    status: row.status,
    organizationBindings: row.bindings ?? [],
  }));

  const activeAgreements = agreements.rows.filter((row) => row.state === 'ACTIVE').length;
  const activeAppointments = appointments.rows.filter((row) => row.state === 'ACTIVE').length;
  const activeJurisdictions = jurisdictions.rows.filter((row) => row.state === 'ACTIVE').length;

  return {
    enterpriseId: root.enterprise_id,
    enterpriseName: root.enterprise_name,
    enterpriseMode: root.enterprise_mode,
    enterpriseStatus: root.enterprise_status,
    selectedOrganizationId: context.organizationId,
    selectedOrganizationName: root.organization_name,
    selectedOrganizationKind: root.organization_kind,
    selectedOrganizationStatus: root.organization_status,
    organizations: organizationItems,
    legalEntities: legalEntityItems,
    commercial: {
      activeAgreements,
      activeAppointments,
      activeJurisdictions,
      agreements: agreements.rows.map((row) => ({
        agreementId: row.enterprise_commercial_agreement_id,
        title: row.title,
        kind: row.agreement_kind,
        state: row.state,
      })),
      appointments: appointments.rows.map((row) => ({
        appointmentId: row.enterprise_appointment_id,
        beneficiaryOrganizationId: row.beneficiary_organization_id,
        beneficiaryOrganizationName: row.beneficiary_organization_name,
        kind: row.appointment_kind,
        state: row.state,
        rights: row.requested_right_types,
      })),
      jurisdictions: jurisdictions.rows.map((row) => ({
        jurisdictionActivationId: row.enterprise_jurisdiction_activation_id,
        organizationName: row.organization_name,
        territoryName: row.territory_name,
        state: row.state,
      })),
    },
    counts: {
      organizations: organizationItems.length,
      activeOrganizations: organizationItems.filter((item) => item.status === 'ACTIVE').length,
      configuringOrganizations: organizationItems.filter((item) =>
        item.status === 'PROVISIONING' || item.status === 'CONFIGURING',
      ).length,
      readyForActivation: organizationItems.filter(
        (item) => item.setupState === 'READY_FOR_ACTIVATION',
      ).length,
      legalEntities: legalEntityItems.length,
      verifiedLegalEntities: legalEntityItems.filter((item) => item.status === 'VERIFIED').length,
      activeAgreements,
      activeAppointments,
      activeJurisdictions,
    },
  };
}
