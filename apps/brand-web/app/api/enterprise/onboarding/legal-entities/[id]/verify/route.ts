import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { verifyEnterpriseLegalEntity } from '@expadio/postgres-runtime/enterprise-legal';
import {
  hasBrandGovernanceForOrganization,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../../../../lib/brand-context';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const { id } = await params;
    const body = await request.json();
    const evidenceRef = typeof body.evidenceRef === 'string' ? body.evidenceRef.trim() : '';
    if (!evidenceRef) {
      return NextResponse.json({ error: 'Verification evidence reference is required.' }, { status: 400 });
    }

    const result = await withBrandTransaction(context, async (client) => {
      if (
        !(await hasBrandGovernanceForOrganization(
          client,
          context.subjectId,
          context.organizationId,
        ))
      ) {
        return { denied: 'ENTERPRISE_LEGAL_ENTITY_VERIFY_FORBIDDEN' } as const;
      }
      const enterprise = await client.query<{ enterprise_id: string }>(
        `SELECT enterprise_id
           FROM platform.organizations
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid
          LIMIT 1`,
        [context.tenantId, context.organizationId],
      );
      const enterpriseId = enterprise.rows[0]?.enterprise_id;
      if (!enterpriseId) throw new Error('ENTERPRISE_PROFILE_NOT_FOUND');

      return verifyEnterpriseLegalEntity(client, {
        tenantId: context.tenantId,
        enterpriseId,
        legalEntityId: id,
        verifierSubjectId: context.subjectId,
        evidenceRef,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });
    });

    if ('denied' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: result.denied, message: 'You are not authorized to verify legal identity.' },
        { status: 403 },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ENTERPRISE_LEGAL_ENTITY_VERIFY_FAILED';
    const status =
      message === 'ENTERPRISE_LEGAL_ENTITY_SEPARATION_OF_DUTIES_REQUIRED'
        ? 409
        : message === 'ENTERPRISE_LEGAL_ENTITY_NOT_FOUND'
          ? 404
          : 400;
    return NextResponse.json(
      {
        denied: true,
        reasonKey: message,
        message:
          message === 'ENTERPRISE_LEGAL_ENTITY_SEPARATION_OF_DUTIES_REQUIRED'
            ? 'A different authorized user must verify this legal entity.'
            : 'The legal entity could not be verified.',
      },
      { status },
    );
  }
}
