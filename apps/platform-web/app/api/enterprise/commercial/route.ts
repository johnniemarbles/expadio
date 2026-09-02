import { NextResponse } from 'next/server';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../lib/request-context';
import { membershipRepository } from '../../../../lib/iam-adapter';
import { hasGovernanceWriteRoleForOrganization } from '../../../../lib/governance-authz';
import {
  approveAndActivateEnterpriseCommercialAgreement,
  approveEnterpriseAppointment,
  createEnterpriseAppointment,
  createEnterpriseCommercialAgreement,
  issueEnterpriseAppointmentRights,
  moveEnterpriseAppointmentToReview,
  startEnterpriseJurisdictionActivation,
  verifyAndActivateEnterpriseJurisdiction,
} from '../../../../lib/enterprise-commercial';
import type { WorkflowActivationVerificationAssessment } from '@expadio/workflow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requiredString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`ENTERPRISE_COMMERCIAL_${key.toUpperCase()}_REQUIRED`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function stringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && entry.trim() !== '')) {
    throw new Error(`ENTERPRISE_COMMERCIAL_${key.toUpperCase()}_INVALID`);
  }
  return [...new Set(value.map((entry) => entry.trim()))];
}

async function accessibleOrganizationIds(
  subjectId: string,
  issuer: string | null,
  tenantId: string,
): Promise<string[]> {
  const memberships = await membershipRepository.listActiveMemberships({
    subjectId,
    issuer: issuer ?? undefined,
    actorKind: 'user',
  } as any);
  return [
    ...new Set(
      memberships
        .filter((membership) => membership.tenantId === tenantId)
        .map((membership) => membership.organizationId),
    ),
  ];
}

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const organizationIds = await accessibleOrganizationIds(
      context.subjectId,
      context.issuer ?? null,
      context.tenantId,
    );
    if (organizationIds.length === 0) {
      return NextResponse.json({
        enterpriseId: null,
        territories: [],
        agreements: [],
        appointments: [],
        jurisdictions: [],
      }, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    const result = await withTenantTransaction(context, async (client) => {
      const enterprise = await client.query<{ readonly enterprise_id: string }>(
        `SELECT enterprise_id
           FROM platform.organizations
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid
          LIMIT 1`,
        [context.tenantId, organizationId],
      );
      const enterpriseId = enterprise.rows[0]?.enterprise_id;
      if (!enterpriseId) throw new Error('ENTERPRISE_CONTEXT_REQUIRED');

      const organizations = await client.query(
        `SELECT organization_id, name, parent_organization_id, organization_kind, status
           FROM platform.organizations
          WHERE tenant_id = $1::uuid
            AND enterprise_id = $2::uuid
            AND organization_id = ANY($3::uuid[])
          ORDER BY name, organization_id`,
        [context.tenantId, enterpriseId, organizationIds],
      );
      const legalEntities = await client.query(
        `SELECT legal_entity_id, legal_name, entity_type,
                jurisdiction_country_code, jurisdiction_subdivision_code, status
           FROM platform.legal_entities
          WHERE tenant_id = $1::uuid
            AND enterprise_id = $2::uuid
            AND status = 'VERIFIED'
          ORDER BY legal_name, legal_entity_id`,
        [context.tenantId, enterpriseId],
      );
      const territories = await client.query(
        `SELECT territory_id, parent_territory_id, territory_key, name,
                territory_kind, country_code, subdivision_code, locality_name, status
           FROM platform.enterprise_territories
          WHERE tenant_id = $1::uuid
            AND enterprise_id = $2::uuid
          ORDER BY territory_kind, name, territory_id`,
        [context.tenantId, enterpriseId],
      );
      const agreements = await client.query(
        `SELECT agreement.enterprise_commercial_agreement_id,
                agreement.agreement_number, agreement.title, agreement.agreement_kind,
                agreement.sponsoring_organization_id, agreement.state,
                agreement.effective_from, agreement.effective_until,
                grantor.legal_name AS grantor_legal_name,
                grantee.legal_name AS grantee_legal_name
           FROM platform.enterprise_commercial_agreements agreement
           JOIN platform.legal_entities grantor
             ON grantor.tenant_id = agreement.tenant_id
            AND grantor.legal_entity_id = agreement.grantor_legal_entity_id
           JOIN platform.legal_entities grantee
             ON grantee.tenant_id = agreement.tenant_id
            AND grantee.legal_entity_id = agreement.grantee_legal_entity_id
          WHERE agreement.tenant_id = $1::uuid
            AND agreement.enterprise_id = $2::uuid
            AND agreement.sponsoring_organization_id = ANY($3::uuid[])
          ORDER BY agreement.created_at DESC, agreement.enterprise_commercial_agreement_id DESC`,
        [context.tenantId, enterpriseId, organizationIds],
      );
      const appointments = await client.query(
        `SELECT appointment.enterprise_appointment_id,
                appointment.enterprise_commercial_agreement_id,
                appointment.grantor_organization_id,
                appointment.beneficiary_organization_id,
                appointment.appointment_kind,
                appointment.requested_right_types,
                appointment.rights_profile_key,
                appointment.state,
                appointment.workflow_instance_id,
                appointment.workflow_rights_grant_id,
                appointment.effective_from,
                appointment.effective_until,
                beneficiary.name AS beneficiary_name,
                grantor.name AS grantor_name,
                COALESCE(
                  jsonb_agg(
                    jsonb_build_object(
                      'territoryId', scope.territory_id,
                      'name', territory.name,
                      'exclusive', scope.exclusive
                    )
                    ORDER BY territory.name
                  ) FILTER (WHERE scope.territory_id IS NOT NULL),
                  '[]'::jsonb
                ) AS territories
           FROM platform.enterprise_appointments appointment
           JOIN platform.organizations beneficiary
             ON beneficiary.tenant_id = appointment.tenant_id
            AND beneficiary.organization_id = appointment.beneficiary_organization_id
           JOIN platform.organizations grantor
             ON grantor.tenant_id = appointment.tenant_id
            AND grantor.organization_id = appointment.grantor_organization_id
           LEFT JOIN platform.enterprise_appointment_territories scope
             ON scope.tenant_id = appointment.tenant_id
            AND scope.enterprise_appointment_id = appointment.enterprise_appointment_id
           LEFT JOIN platform.enterprise_territories territory
             ON territory.tenant_id = scope.tenant_id
            AND territory.territory_id = scope.territory_id
          WHERE appointment.tenant_id = $1::uuid
            AND appointment.enterprise_id = $2::uuid
            AND (
              appointment.grantor_organization_id = ANY($3::uuid[])
              OR appointment.beneficiary_organization_id = ANY($3::uuid[])
            )
          GROUP BY appointment.enterprise_appointment_id,
                   beneficiary.name, grantor.name
          ORDER BY appointment.created_at DESC, appointment.enterprise_appointment_id DESC`,
        [context.tenantId, enterpriseId, organizationIds],
      );
      const jurisdictions = await client.query(
        `SELECT activation.enterprise_jurisdiction_activation_id,
                activation.organization_id,
                organization.name AS organization_name,
                activation.enterprise_appointment_id,
                activation.territory_id,
                territory.name AS territory_name,
                territory.country_code,
                territory.subdivision_code,
                activation.workflow_activation_id,
                activation.state,
                activation.approved_at,
                activation.activated_at
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
          ORDER BY activation.created_at DESC,
                   activation.enterprise_jurisdiction_activation_id DESC`,
        [context.tenantId, enterpriseId, organizationIds],
      );

      return {
        enterpriseId,
        organizations: organizations.rows,
        legalEntities: legalEntities.rows,
        territories: territories.rows,
        agreements: agreements.rows,
        appointments: appointments.rows,
        jurisdictions: jurisdictions.rows,
      };
    });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    if (!organizationId) throw new Error('ORGANIZATION_CONTEXT_REQUIRED');
    const organizationId = organizationId;
    const body = await request.json() as Record<string, unknown>;
    const action = requiredString(body.action, 'action');

    const result = await withTenantTransaction(context, async (client) => {
      const enterprise = await client.query<{ readonly enterprise_id: string }>(
        `SELECT enterprise_id
           FROM platform.organizations
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid
          LIMIT 1`,
        [context.tenantId, organizationId],
      );
      const enterpriseId = enterprise.rows[0]?.enterprise_id;
      if (!enterpriseId) throw new Error('ENTERPRISE_CONTEXT_REQUIRED');

      const requireAuthority = async (organizationId: string) => {
        if (!(await hasGovernanceWriteRoleForOrganization(client, context.subjectId, organizationId))) {
          throw new Error('ENTERPRISE_ORGANIZATION_GOVERNANCE_REQUIRED');
        }
      };

      switch (action) {
        case 'CREATE_TERRITORY': {
          await requireAuthority(organizationId);
          const territoryId = crypto.randomUUID();
          await client.query(
            `INSERT INTO platform.enterprise_territories (
               territory_id, tenant_id, enterprise_id, parent_territory_id,
               territory_key, name, territory_kind, country_code,
               subdivision_code, locality_name, external_geography_ref,
               created_by_subject_id
             ) VALUES (
               $1::uuid, $2::uuid, $3::uuid, $4::uuid,
               $5, $6, $7, $8, $9, $10, $11, $12
             )`,
            [
              territoryId,
              context.tenantId,
              enterpriseId,
              optionalString(body.parentTerritoryId),
              requiredString(body.territoryKey, 'territoryKey'),
              requiredString(body.name, 'name'),
              requiredString(body.territoryKind, 'territoryKind'),
              optionalString(body.countryCode)?.toUpperCase() ?? null,
              optionalString(body.subdivisionCode),
              optionalString(body.localityName),
              optionalString(body.externalGeographyRef),
              context.subjectId,
            ],
          );
          return { territoryId };
        }

        case 'CREATE_AGREEMENT': {
          const sponsoringOrganizationId =
            optionalString(body.sponsoringOrganizationId) ?? organizationId;
          await requireAuthority(sponsoringOrganizationId);
          return createEnterpriseCommercialAgreement(client, {
            tenantId: context.tenantId,
            enterpriseId,
            title: requiredString(body.title, 'title'),
            agreementKind: requiredString(body.agreementKind, 'agreementKind'),
            agreementNumber: optionalString(body.agreementNumber),
            grantorLegalEntityId: requiredString(body.grantorLegalEntityId, 'grantorLegalEntityId'),
            granteeLegalEntityId: requiredString(body.granteeLegalEntityId, 'granteeLegalEntityId'),
            sponsoringOrganizationId,
            governingLawCountryCode: optionalString(body.governingLawCountryCode)?.toUpperCase() ?? null,
            governingLawSubdivisionCode: optionalString(body.governingLawSubdivisionCode),
            createdBySubjectId: context.subjectId,
          });
        }

        case 'ACTIVATE_AGREEMENT': {
          await requireAuthority(organizationId);
          await approveAndActivateEnterpriseCommercialAgreement(client, {
            tenantId: context.tenantId,
            agreementId: requiredString(body.agreementId, 'agreementId'),
            approvedBySubjectId: context.subjectId,
            executionEvidenceRefs: stringArray(body.executionEvidenceRefs, 'executionEvidenceRefs'),
            effectiveFrom: optionalString(body.effectiveFrom) ?? undefined,
            effectiveUntil: optionalString(body.effectiveUntil),
          });
          return { ok: true };
        }

        case 'CREATE_APPOINTMENT': {
          const grantorOrganizationId =
            optionalString(body.grantorOrganizationId) ?? organizationId;
          await requireAuthority(grantorOrganizationId);
          return createEnterpriseAppointment(client, {
            tenantId: context.tenantId,
            enterpriseId,
            agreementId: requiredString(body.agreementId, 'agreementId'),
            grantorOrganizationId,
            beneficiaryOrganizationId: requiredString(body.beneficiaryOrganizationId, 'beneficiaryOrganizationId'),
            beneficiaryLegalEntityId: requiredString(body.beneficiaryLegalEntityId, 'beneficiaryLegalEntityId'),
            appointmentKind: requiredString(body.appointmentKind, 'appointmentKind'),
            rightsProfileKey: requiredString(body.rightsProfileKey, 'rightsProfileKey'),
            requestedRightTypes: stringArray(body.requestedRightTypes, 'requestedRightTypes'),
            territoryIds: stringArray(body.territoryIds, 'territoryIds'),
            exclusive: body.exclusive === true,
            exclusivityKey: optionalString(body.exclusivityKey),
            delegationRequested: body.delegationRequested === true,
            subAppointmentRequested: body.subAppointmentRequested === true,
            channelKeys: Array.isArray(body.channelKeys) ? stringArray(body.channelKeys, 'channelKeys') : [],
            productKeys: Array.isArray(body.productKeys) ? stringArray(body.productKeys, 'productKeys') : [],
            effectiveFrom: optionalString(body.effectiveFrom) ?? undefined,
            effectiveUntil: optionalString(body.effectiveUntil),
            requestedBySubjectId: context.subjectId,
          });
        }

        case 'MOVE_APPOINTMENT_TO_REVIEW': {
          await requireAuthority(organizationId);
          await moveEnterpriseAppointmentToReview(client, {
            tenantId: context.tenantId,
            appointmentId: requiredString(body.appointmentId, 'appointmentId'),
            actorSubjectId: context.subjectId,
          });
          return { ok: true };
        }

        case 'APPROVE_APPOINTMENT': {
          await requireAuthority(organizationId);
          await approveEnterpriseAppointment(client, {
            tenantId: context.tenantId,
            appointmentId: requiredString(body.appointmentId, 'appointmentId'),
            approverSubjectId: context.subjectId,
          });
          return { ok: true };
        }

        case 'ISSUE_APPOINTMENT_RIGHTS': {
          await requireAuthority(organizationId);
          return issueEnterpriseAppointmentRights(client, {
            tenantId: context.tenantId,
            appointmentId: requiredString(body.appointmentId, 'appointmentId'),
            actorSubjectId: context.subjectId,
            grantId: optionalString(body.grantId) ?? undefined,
            evidenceRefs: stringArray(body.evidenceRefs, 'evidenceRefs'),
          });
        }

        case 'START_JURISDICTION_ACTIVATION': {
          await requireAuthority(organizationId);
          return startEnterpriseJurisdictionActivation(client, {
            tenantId: context.tenantId,
            enterpriseId,
            appointmentId: requiredString(body.appointmentId, 'appointmentId'),
            territoryId: requiredString(body.territoryId, 'territoryId'),
            requestedBySubjectId: context.subjectId,
            activationId: optionalString(body.activationId) ?? undefined,
            evidenceRefs: stringArray(body.evidenceRefs, 'evidenceRefs'),
          });
        }

        case 'VERIFY_AND_ACTIVATE_JURISDICTION': {
          await requireAuthority(organizationId);
          const assessments = body.assessments;
          if (!Array.isArray(assessments)) {
            throw new Error('ENTERPRISE_COMMERCIAL_ASSESSMENTS_INVALID');
          }
          await verifyAndActivateEnterpriseJurisdiction(client, {
            tenantId: context.tenantId,
            jurisdictionActivationId: requiredString(
              body.jurisdictionActivationId,
              'jurisdictionActivationId',
            ),
            verifiedBySubjectId: context.subjectId,
            reason: requiredString(body.reason, 'reason'),
            assessments: assessments as WorkflowActivationVerificationAssessment[],
            evidenceRefs: stringArray(body.evidenceRefs, 'evidenceRefs'),
            verificationId: optionalString(body.verificationId) ?? undefined,
          });
          return { ok: true };
        }

        default:
          throw new Error('ENTERPRISE_COMMERCIAL_ACTION_UNSUPPORTED');
      }
    });

    return NextResponse.json(result);
  } catch (error) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
