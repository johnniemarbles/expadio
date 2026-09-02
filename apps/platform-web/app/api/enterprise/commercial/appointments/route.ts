import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  createEnterpriseAppointmentDraft,
  markEnterpriseAppointmentUnderReview,
  submitEnterpriseAppointment,
} from '@expadio/postgres-runtime/enterprise-commercial';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import { hasGovernanceWriteRoleForOrganization } from '@/lib/governance-authz';
import {
  assertDescendantOrganization,
  assertEnterpriseLegalEntity,
  enterpriseCommercialHttpError,
  resolveEnterpriseCommercialScope,
} from '@/lib/enterprise-commercial-context';
import { startWorkflow, transitionWorkflow } from '@/lib/workflow-runtime';

const KINDS = new Set([
  'MASTER_FRANCHISEE','FRANCHISEE','DISTRIBUTOR','WHOLESALER','RETAILER',
  'AFFILIATE','BROKER','LICENSEE','OPERATOR','AGENT',
  'MANAGEMENT_PROVIDER','SERVICE_PROVIDER','JV_PARTNER','OTHER',
]);

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED', message: 'Select the appointing organization.' },
        { status: 403 },
      );
    }
    const body = await request.json();
    if (!KINDS.has(body.appointmentKind)) {
      return NextResponse.json({ error: 'Unsupported appointment kind.' }, { status: 400 });
    }
    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey) {
      return NextResponse.json({ error: 'Idempotency-Key header is required.' }, { status: 400 });
    }

    const value = await withTenantTransaction(context, async (client) => {
      if (!(await hasGovernanceWriteRoleForOrganization(client, context.subjectId, context.organizationId!))) {
        return { forbidden: true } as const;
      }
      const scope = await resolveEnterpriseCommercialScope(client, {
        tenantId: context.tenantId,
        organizationId: context.organizationId!,
      });
      const beneficiaryOrganizationId =
        typeof body.beneficiaryOrganizationId === 'string'
          ? body.beneficiaryOrganizationId
          : '';
      const beneficiaryLegalEntityId =
        typeof body.beneficiaryLegalEntityId === 'string'
          ? body.beneficiaryLegalEntityId
          : '';
      await assertDescendantOrganization(client, {
        tenantId: context.tenantId,
        enterpriseId: scope.enterpriseId,
        ancestorOrganizationId: context.organizationId!,
        descendantOrganizationId: beneficiaryOrganizationId,
      });
      await assertEnterpriseLegalEntity(client, {
        tenantId: context.tenantId,
        enterpriseId: scope.enterpriseId,
        legalEntityId: beneficiaryLegalEntityId,
        verified: true,
      });
      const binding = await client.query(
        `SELECT 1
           FROM platform.organization_legal_entity_bindings
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid
            AND legal_entity_id = $3::uuid
            AND status = 'ACTIVE'
            AND valid_from <= now()
            AND (valid_until IS NULL OR valid_until > now())
          LIMIT 1`,
        [context.tenantId, beneficiaryOrganizationId, beneficiaryLegalEntityId],
      );
      if (!binding.rows[0]) throw new Error('ENTERPRISE_APPOINTMENT_BENEFICIARY_ENTITY_BINDING_REQUIRED');

      const agreementId = typeof body.agreementId === 'string' ? body.agreementId : '';
      const sponsoredAgreement = await client.query(
        `SELECT 1
           FROM platform.enterprise_commercial_agreements
          WHERE tenant_id = $1::uuid
            AND enterprise_commercial_agreement_id = $2::uuid
            AND enterprise_id = $3::uuid
            AND sponsoring_organization_id = $4::uuid
            AND state IN ('APPROVED','ACTIVE')`,
        [context.tenantId, agreementId, scope.enterpriseId, context.organizationId],
      );
      if (!sponsoredAgreement.rows[0]) {
        throw new Error('ENTERPRISE_APPOINTMENT_AGREEMENT_SCOPE_MISMATCH');
      }

      const drafted = await createEnterpriseAppointmentDraft(client, {
        tenantId: context.tenantId,
        enterpriseId: scope.enterpriseId,
        agreementId,
        grantorOrganizationId: context.organizationId!,
        beneficiaryOrganizationId,
        beneficiaryLegalEntityId,
        appointmentKind: body.appointmentKind,
        requestedRightTypes: Array.isArray(body.requestedRightTypes)
          ? body.requestedRightTypes.filter((item: unknown): item is string => typeof item === 'string')
          : [],
        territoryIds: Array.isArray(body.territoryIds)
          ? body.territoryIds.filter((item: unknown): item is string => typeof item === 'string')
          : [],
        exclusiveTerritoryIds: Array.isArray(body.exclusiveTerritoryIds)
          ? body.exclusiveTerritoryIds.filter((item: unknown): item is string => typeof item === 'string')
          : [],
        exclusivityKey: typeof body.exclusivityKey === 'string' ? body.exclusivityKey : null,
        delegationRequested: body.delegationRequested === true,
        subAppointmentRequested: body.subAppointmentRequested === true,
        channelKeys: Array.isArray(body.channelKeys)
          ? body.channelKeys.filter((item: unknown): item is string => typeof item === 'string')
          : [],
        productKeys: Array.isArray(body.productKeys)
          ? body.productKeys.filter((item: unknown): item is string => typeof item === 'string')
          : [],
        effectiveFrom: typeof body.effectiveFrom === 'string' ? body.effectiveFrom : null,
        effectiveUntil: typeof body.effectiveUntil === 'string' ? body.effectiveUntil : null,
        idempotencyKey,
        requestedBySubjectId: context.subjectId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });

      if (drafted.appointment.workflowInstanceId) {
        return { appointment: drafted.appointment, idempotent: true };
      }

      const started = await startWorkflow(client, {
        tenantId: context.tenantId,
        subjectType: 'enterprise.appointment',
        subjectId: drafted.appointment.appointmentId,
        blueprintKey: 'enterprise.commercial-appointment',
      });
      if (!started.ok) throw new Error('ENTERPRISE_APPOINTMENT_BLUEPRINT_NOT_FOUND');

      const submitted = await submitEnterpriseAppointment(client, {
        tenantId: context.tenantId,
        appointmentId: drafted.appointment.appointmentId,
        workflowInstanceId: started.instance.instanceId,
        submittedBySubjectId: context.subjectId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });
      const moved = await transitionWorkflow(client, {
        tenantId: context.tenantId,
        instanceId: started.instance.instanceId,
        expectedRevision: started.instance.revision,
        toStageKey: 'COMMERCIAL_REVIEW',
        requestedBySubjectId: context.subjectId,
        reason: 'Commercial appointment submitted for governed review.',
      });
      if (!moved.ok) throw new Error('ENTERPRISE_APPOINTMENT_REVIEW_TRANSITION_FAILED');

      const underReview = await markEnterpriseAppointmentUnderReview(client, {
        tenantId: context.tenantId,
        appointmentId: submitted.appointmentId,
        actorSubjectId: context.subjectId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });
      return { appointment: underReview, idempotent: false };
    });

    if ('forbidden' in value) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ENTERPRISE_APPOINTMENT_FORBIDDEN', message: 'You are not authorized to appoint organizations from this scope.' },
        { status: 403 },
      );
    }
    return NextResponse.json(value, { status: value.idempotent ? 200 : 201 });
  } catch (error) {
    const mapped = enterpriseCommercialHttpError(error);
    if (mapped.status !== 500) return NextResponse.json(mapped.body, { status: mapped.status });
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
