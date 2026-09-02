import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  verifyEnterpriseJurisdictionActivation,
} from '@expadio/postgres-runtime/enterprise-commercial';
import type { WorkflowActivationVerificationAssessment } from '@expadio/workflow';
import { resolveRequestContext, withTenantTransaction } from '@/lib/request-context';
import { hasGovernanceWriteRoleForOrganization } from '@/lib/governance-authz';
import { enterpriseCommercialHttpError } from '@/lib/enterprise-commercial-context';

const DIMENSIONS = new Set(['AGREEMENT','RIGHTS','ACCESS','COMPLIANCE','OPERATIONAL_READINESS']);
const OUTCOMES = new Set(['SATISFIED','NOT_SATISFIED','NOT_APPLICABLE']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED', message: 'Select the appointing organization.' },
        { status: 403 },
      );
    }
    const { id } = await params;
    const body = await request.json();
    const assessments: WorkflowActivationVerificationAssessment[] =
      Array.isArray(body.assessments)
        ? body.assessments.flatMap((item: any) => {
            if (!DIMENSIONS.has(item?.dimension) || !OUTCOMES.has(item?.outcome)) return [];
            return [{
              dimension: item.dimension,
              outcome: item.outcome,
              reason: typeof item.reason === 'string' ? item.reason : '',
              evidenceRefs: Array.isArray(item.evidenceRefs)
                ? item.evidenceRefs.filter((value: unknown): value is string => typeof value === 'string')
                : [],
            } as WorkflowActivationVerificationAssessment];
          })
        : [];

    const value = await withTenantTransaction(context, async (client) => {
      if (!(await hasGovernanceWriteRoleForOrganization(client, context.subjectId, context.organizationId!))) {
        return { forbidden: true } as const;
      }
      const owned = await client.query(
        `SELECT 1
           FROM platform.enterprise_jurisdiction_activations jurisdiction
           JOIN platform.enterprise_appointments appointment
             ON appointment.tenant_id = jurisdiction.tenant_id
            AND appointment.enterprise_appointment_id = jurisdiction.enterprise_appointment_id
          WHERE jurisdiction.tenant_id = $1::uuid
            AND jurisdiction.enterprise_jurisdiction_activation_id = $2::uuid
            AND appointment.grantor_organization_id = $3::uuid`,
        [context.tenantId, id, context.organizationId],
      );
      if (!owned.rows[0]) return { forbidden: true } as const;
      return verifyEnterpriseJurisdictionActivation(client, {
        tenantId: context.tenantId,
        jurisdictionActivationId: id,
        assessments,
        verifiedBySubjectId: context.subjectId,
        reason: typeof body.reason === 'string' ? body.reason : 'Jurisdiction activation verification.',
        evidenceRefs: Array.isArray(body.evidenceRefs)
          ? body.evidenceRefs.filter((value: unknown): value is string => typeof value === 'string')
          : [],
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });
    });
    if ('forbidden' in value) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ENTERPRISE_JURISDICTION_VERIFICATION_FORBIDDEN', message: 'This jurisdiction is outside the selected governing scope.' },
        { status: 403 },
      );
    }
    return NextResponse.json(value);
  } catch (error) {
    const mapped = enterpriseCommercialHttpError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
