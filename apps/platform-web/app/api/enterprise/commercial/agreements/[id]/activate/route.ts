import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { activateEnterpriseCommercialAgreement } from '@expadio/postgres-runtime/enterprise-commercial';
import { resolveRequestContext, withTenantTransaction } from '@/lib/request-context';
import { hasGovernanceWriteRoleForOrganization } from '@/lib/governance-authz';
import { enterpriseCommercialHttpError } from '@/lib/enterprise-commercial-context';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED', message: 'Select the sponsoring organization.' },
        { status: 403 },
      );
    }
    const { id } = await params;
    const body = await request.json();
    const evidenceRefs = Array.isArray(body.evidenceRefs)
      ? body.evidenceRefs.filter((value: unknown): value is string => typeof value === 'string')
      : [];
    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasGovernanceWriteRoleForOrganization(client, context.subjectId, context.organizationId!))) {
        return { forbidden: true } as const;
      }
      const owned = await client.query(
        `SELECT 1
           FROM platform.enterprise_commercial_agreements
          WHERE tenant_id = $1::uuid
            AND enterprise_commercial_agreement_id = $2::uuid
            AND sponsoring_organization_id = $3::uuid`,
        [context.tenantId, id, context.organizationId],
      );
      if (!owned.rows[0]) return { forbidden: true } as const;
      return activateEnterpriseCommercialAgreement(client, {
        tenantId: context.tenantId,
        agreementId: id,
        activatedBySubjectId: context.subjectId,
        evidenceRefs,
        effectiveFrom: typeof body.effectiveFrom === 'string' ? body.effectiveFrom : null,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });
    });
    if ('forbidden' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ENTERPRISE_AGREEMENT_ACTIVATION_FORBIDDEN', message: 'This agreement is outside the selected governing scope.' },
        { status: 403 },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    const mapped = enterpriseCommercialHttpError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
