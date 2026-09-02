import { NextResponse } from 'next/server';
import { listEnterpriseCommercialPortfolio } from '@expadio/postgres-runtime/enterprise-commercial';
import { listEnterpriseOwnershipInterests } from '@expadio/postgres-runtime/enterprise-ownership';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import { resolveEnterpriseCommercialScope } from '@/lib/enterprise-commercial-context';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED',
          message: 'Select an active organization workspace.',
        },
        { status: 403 },
      );
    }

    const value = await withTenantTransaction(context, async (client) => {
      const scope = await resolveEnterpriseCommercialScope(client, {
        tenantId: context.tenantId,
        organizationId: context.organizationId!,
      });
      const allowed = await client.query<{
        organization_id: string;
        name: string;
        organization_kind: string;
        status: string;
        parent_organization_id: string | null;
      }>(
        `SELECT organization.organization_id, organization.name,
                organization.organization_kind, organization.status,
                organization.parent_organization_id
           FROM platform.organization_closure closure
           JOIN platform.organizations organization
             ON organization.tenant_id = closure.tenant_id
            AND organization.organization_id = closure.descendant_organization_id
          WHERE closure.tenant_id = $1::uuid
            AND closure.ancestor_organization_id = $2::uuid
            AND organization.enterprise_id = $3::uuid
          ORDER BY closure.depth ASC, organization.name ASC`,
        [context.tenantId, context.organizationId, scope.enterpriseId],
      );
      const allowedIds = allowed.rows.map((row) => row.organization_id);
      const allowedSet = new Set(allowedIds);

      const portfolio = await listEnterpriseCommercialPortfolio(client, {
        tenantId: context.tenantId,
        enterpriseId: scope.enterpriseId,
      });
      const visibleAgreements = portfolio.agreements.filter((item) =>
        allowedSet.has(item.sponsoringOrganizationId)
      );
      const visibleAppointments = portfolio.appointments.filter(
        (item) =>
          allowedSet.has(item.grantorOrganizationId)
          || allowedSet.has(item.beneficiaryOrganizationId),
      );
      const visibleJurisdictions = portfolio.jurisdictions.filter((item) =>
        allowedSet.has(item.organizationId)
      );

      const visibleAppointmentIds = visibleAppointments.map((item) => item.appointmentId);
      const appointmentTerritories = visibleAppointmentIds.length === 0
        ? { rows: [] as Array<{
            enterprise_appointment_id: string;
            territory_id: string;
            territory_name: string;
            exclusive: boolean;
          }> }
        : await client.query<{
            enterprise_appointment_id: string;
            territory_id: string;
            territory_name: string;
            exclusive: boolean;
          }>(
            `SELECT scope.enterprise_appointment_id, scope.territory_id,
                    territory.name AS territory_name, scope.exclusive
               FROM platform.enterprise_appointment_territories scope
               JOIN platform.enterprise_territories territory
                 ON territory.tenant_id = scope.tenant_id
                AND territory.territory_id = scope.territory_id
              WHERE scope.tenant_id = $1::uuid
                AND scope.enterprise_appointment_id = ANY($2::uuid[])
              ORDER BY scope.enterprise_appointment_id, territory.name`,
            [context.tenantId, visibleAppointmentIds],
          );

      const visibleActivationIds = visibleJurisdictions
        .map((item) => item.workflowActivationId)
        .filter((value): value is string => value !== null);
      const activationVerifications = visibleActivationIds.length === 0
        ? { rows: [] as Array<{
            activation_id: string;
            state: string;
            verified_at: Date | string;
          }> }
        : await client.query<{
            activation_id: string;
            state: string;
            verified_at: Date | string;
          }>(
            `SELECT DISTINCT ON (activation_id)
                    activation_id, state, verified_at
               FROM platform.workflow_activation_verifications
              WHERE tenant_id = $1::uuid
                AND activation_id = ANY($2::uuid[])
              ORDER BY activation_id, verified_at DESC, verification_id DESC`,
            [context.tenantId, visibleActivationIds],
          );
      const verificationByActivation = new Map(
        activationVerifications.rows.map((row) => [
          row.activation_id,
          {
            state: row.state,
            verifiedAt:
              row.verified_at instanceof Date
                ? row.verified_at.toISOString()
                : new Date(row.verified_at).toISOString(),
          },
        ]),
      );

      const legalEntities = await client.query<{
        legal_entity_id: string;
        legal_name: string;
        entity_type: string;
        jurisdiction_country_code: string;
        status: string;
        organization_ids: string[];
      }>(
        `SELECT DISTINCT legal_entity.legal_entity_id, legal_entity.legal_name,
                legal_entity.entity_type, legal_entity.jurisdiction_country_code,
                legal_entity.status,
                ARRAY(
                  SELECT DISTINCT binding.organization_id
                    FROM platform.organization_legal_entity_bindings binding
                   WHERE binding.tenant_id = legal_entity.tenant_id
                     AND binding.legal_entity_id = legal_entity.legal_entity_id
                     AND binding.organization_id = ANY($3::uuid[])
                     AND binding.status = 'ACTIVE'
                     AND binding.valid_from <= now()
                     AND (binding.valid_until IS NULL OR binding.valid_until > now())
                   ORDER BY binding.organization_id
                ) AS organization_ids
           FROM platform.legal_entities legal_entity
          WHERE legal_entity.tenant_id = $1::uuid
            AND legal_entity.enterprise_id = $2::uuid
            AND (
              EXISTS (
                SELECT 1
                  FROM platform.organization_legal_entity_bindings binding
                 WHERE binding.tenant_id = legal_entity.tenant_id
                   AND binding.legal_entity_id = legal_entity.legal_entity_id
                   AND binding.organization_id = ANY($3::uuid[])
              )
              OR EXISTS (
                SELECT 1
                  FROM platform.enterprise_commercial_agreements agreement
                 WHERE agreement.tenant_id = legal_entity.tenant_id
                   AND agreement.sponsoring_organization_id = ANY($3::uuid[])
                   AND legal_entity.legal_entity_id IN (
                     agreement.grantor_legal_entity_id,
                     agreement.grantee_legal_entity_id
                   )
              )
            )
          ORDER BY legal_entity.legal_name`,
        [context.tenantId, scope.enterpriseId, allowedIds],
      );

      const visibleLegalEntityIds = legalEntities.rows.map(
        (row) => row.legal_entity_id,
      );
      const ownershipInterests = await listEnterpriseOwnershipInterests(client, {
        tenantId: context.tenantId,
        legalEntityIds: visibleLegalEntityIds,
      });

      const setup = await client.query<{
        organization_id: string;
        state: string;
        completion_percent: string | number;
        blocking_open_requirements: number;
      }>(
        `SELECT plan.organization_id, plan.state, plan.completion_percent,
                plan.blocking_open_requirements
           FROM platform.organization_setup_plans plan
          WHERE plan.tenant_id = $1::uuid
            AND plan.organization_id = ANY($2::uuid[])
          ORDER BY plan.updated_at DESC`,
        [context.tenantId, allowedIds],
      );

      const perspectiveRows = await client.query<{
        perspective: string;
        entity_type: string;
        entity_id: string;
        display_name: string | null;
        edge_path: unknown[];
        effective_from: Date | string;
        provenance_source: string;
        confidence: string | number;
      }>(
        `WITH requested_perspectives(perspective) AS (
           VALUES
             ('GOVERNANCE'::text),
             ('OWNERSHIP_LEGAL'::text),
             ('COMMERCIAL'::text),
             ('TERRITORY_JURISDICTION'::text),
             ('OPERATIONAL'::text)
         ),
         projected AS (
           SELECT
             requested.perspective,
             projection.entity_type,
             projection.entity_id,
             projection.edge_path,
             projection.effective_from,
             projection.provenance_source,
             projection.confidence,
             jsonb_array_length(projection.edge_path) AS path_depth
           FROM requested_perspectives requested
           CROSS JOIN LATERAL platform.project_entity_perspective(
             $1::uuid,
             'OPERATING_UNIT',
             $2::text,
             requested.perspective,
             now()
           ) projection
         )
         SELECT DISTINCT ON (
           projected.perspective,
           projected.entity_type,
           projected.entity_id
         )
           projected.perspective,
           projected.entity_type,
           projected.entity_id,
           node.display_name,
           projected.edge_path,
           projected.effective_from,
           projected.provenance_source,
           projected.confidence
         FROM projected
         LEFT JOIN platform.entity_registry_nodes node
           ON node.tenant_id = $1::uuid
          AND node.node_type = projected.entity_type
          AND node.entity_key = projected.entity_id
          AND node.status = 'ACTIVE'
          AND node.valid_until IS NULL
         ORDER BY
           projected.perspective,
           projected.entity_type,
           projected.entity_id,
           projected.path_depth ASC,
           projected.effective_from DESC`,
        [context.tenantId, context.organizationId],
      );

      const pending = await client.query<{
        enterprise_change_request_id: string;
        operation: string;
        status: string;
        target_organization_id: string | null;
        target_legal_entity_id: string | null;
        requested_at: Date | string;
      }>(
        `SELECT enterprise_change_request_id, operation, status,
                target_organization_id, target_legal_entity_id, requested_at
           FROM platform.enterprise_change_requests
          WHERE tenant_id = $1::uuid
            AND enterprise_id = $2::uuid
            AND (
              requesting_organization_id = ANY($3::uuid[])
              OR approving_organization_id = ANY($3::uuid[])
            )
            AND status IN ('SUBMITTED','UNDER_REVIEW','CHANGES_REQUESTED')
          ORDER BY requested_at DESC
          LIMIT 100`,
        [context.tenantId, scope.enterpriseId, allowedIds],
      );

      return {
        scope,
        organizations: allowed.rows,
        legalEntities: legalEntities.rows,
        ownershipInterests,
        setupReadiness: setup.rows.map((row) => ({
          organizationId: row.organization_id,
          state: row.state,
          completionPercent: Number(row.completion_percent),
          blockingOpenRequirements: Number(row.blocking_open_requirements),
        })),
        perspectives: [
          'GOVERNANCE',
          'OWNERSHIP_LEGAL',
          'COMMERCIAL',
          'TERRITORY_JURISDICTION',
          'OPERATIONAL',
        ].map((perspective) => ({
          perspective,
          nodes: perspectiveRows.rows
            .filter((row) => row.perspective === perspective)
            .map((row) => ({
              entityType: row.entity_type,
              entityId: row.entity_id,
              displayName: row.display_name,
              edgePath: row.edge_path,
              pathDepth: Array.isArray(row.edge_path) ? row.edge_path.length : 0,
              effectiveFrom:
                row.effective_from instanceof Date
                  ? row.effective_from.toISOString()
                  : new Date(row.effective_from).toISOString(),
              provenanceSource: row.provenance_source,
              confidence: Number(row.confidence),
            })),
        })),
        pendingChangeRequests: pending.rows.map((row) => ({
          ...row,
          requested_at:
            row.requested_at instanceof Date
              ? row.requested_at.toISOString()
              : new Date(row.requested_at).toISOString(),
        })),
        portfolio: {
          territories: portfolio.territories,
          agreements: visibleAgreements,
          appointments: visibleAppointments.map((item) => ({
            ...item,
            territories: appointmentTerritories.rows
              .filter((scopeRow) => scopeRow.enterprise_appointment_id === item.appointmentId)
              .map((scopeRow) => ({
                territoryId: scopeRow.territory_id,
                name: scopeRow.territory_name,
                exclusive: scopeRow.exclusive,
              })),
          })),
          jurisdictions: visibleJurisdictions.map((item) => ({
            ...item,
            verification:
              item.workflowActivationId === null
                ? null
                : verificationByActivation.get(item.workflowActivationId) ?? null,
          })),
        },
      };
    });

    return NextResponse.json(value, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
