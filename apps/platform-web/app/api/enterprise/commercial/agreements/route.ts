import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createEnterpriseCommercialAgreement } from '@expadio/postgres-runtime/enterprise-commercial';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import { hasGovernanceWriteRoleForOrganization } from '@/lib/governance-authz';
import {
  assertEnterpriseLegalEntity,
  enterpriseCommercialHttpError,
  resolveEnterpriseCommercialScope,
} from '@/lib/enterprise-commercial-context';

const KINDS = new Set([
  'FRANCHISE','MASTER_FRANCHISE','DISTRIBUTION','WHOLESALE','RETAIL',
  'AFFILIATE','BROKER','LICENSE','AGENCY','MANAGEMENT','SERVICE',
  'JOINT_VENTURE','OTHER',
]);

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED', message: 'Select an active governing organization.' },
        { status: 403 },
      );
    }
    const body = await request.json();
    if (!KINDS.has(body.agreementKind)) {
      return NextResponse.json({ error: 'Unsupported commercial agreement kind.' }, { status: 400 });
    }
    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey) {
      return NextResponse.json({ error: 'Idempotency-Key header is required.' }, { status: 400 });
    }

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasGovernanceWriteRoleForOrganization(client, context.subjectId, context.organizationId!))) {
        return { forbidden: true } as const;
      }
      const scope = await resolveEnterpriseCommercialScope(client, {
        tenantId: context.tenantId,
        organizationId: context.organizationId!,
      });
      const grantorLegalEntityId =
        typeof body.grantorLegalEntityId === 'string' ? body.grantorLegalEntityId : '';
      const granteeLegalEntityId =
        typeof body.granteeLegalEntityId === 'string' ? body.granteeLegalEntityId : '';
      await assertEnterpriseLegalEntity(client, {
        tenantId: context.tenantId,
        enterpriseId: scope.enterpriseId,
        legalEntityId: grantorLegalEntityId,
        verified: true,
      });
      await assertEnterpriseLegalEntity(client, {
        tenantId: context.tenantId,
        enterpriseId: scope.enterpriseId,
        legalEntityId: granteeLegalEntityId,
        verified: true,
      });

      return createEnterpriseCommercialAgreement(client, {
        tenantId: context.tenantId,
        enterpriseId: scope.enterpriseId,
        agreementNumber: typeof body.agreementNumber === 'string' ? body.agreementNumber : null,
        title: typeof body.title === 'string' ? body.title : '',
        agreementKind: body.agreementKind,
        grantorLegalEntityId,
        granteeLegalEntityId,
        sponsoringOrganizationId: context.organizationId!,
        governingLawCountryCode:
          typeof body.governingLawCountryCode === 'string' ? body.governingLawCountryCode : null,
        governingLawSubdivisionCode:
          typeof body.governingLawSubdivisionCode === 'string' ? body.governingLawSubdivisionCode : null,
        effectiveFrom: typeof body.effectiveFrom === 'string' ? body.effectiveFrom : null,
        effectiveUntil: typeof body.effectiveUntil === 'string' ? body.effectiveUntil : null,
        idempotencyKey,
        createdBySubjectId: context.subjectId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });
    });
    if ('forbidden' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ENTERPRISE_AGREEMENT_FORBIDDEN', message: 'You are not authorized to create commercial agreements.' },
        { status: 403 },
      );
    }
    return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    const mapped = enterpriseCommercialHttpError(error);
    if (mapped.status !== 500) return NextResponse.json(mapped.body, { status: mapped.status });
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
