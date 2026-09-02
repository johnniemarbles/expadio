import { NextResponse } from 'next/server';
import { approveEnterpriseProfileConfiguration } from '@expadio/postgres-runtime/enterprise-profile';
import {
  hasBrandGovernanceForOrganization,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../../../../../lib/brand-context';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const outcome = await withBrandTransaction(context, async (client) => {
      if (
        !(await hasBrandGovernanceForOrganization(
          client,
          context.subjectId,
          context.organizationId,
        ))
      ) {
        return { denied: 'ENTERPRISE_PROFILE_DECISION_FORBIDDEN' } as const;
      }

      const selected = await client.query<{ enterprise_id: string }>(
        `SELECT enterprise_id
           FROM platform.organizations
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid
            AND parent_organization_id IS NULL
            AND status = 'ACTIVE'
          LIMIT 1`,
        [context.tenantId, context.organizationId],
      );
      const enterpriseId = selected.rows[0]?.enterprise_id;
      if (!enterpriseId) {
        return { denied: 'ENTERPRISE_PROFILE_ROOT_AUTHORITY_REQUIRED' } as const;
      }

      return approveEnterpriseProfileConfiguration(client, {
        tenantId: context.tenantId,
        enterpriseId,
        requestId: id,
        approverOrganizationId: context.organizationId,
        decidedBySubjectId: context.subjectId,
        decisionReason:
          typeof body.reason === 'string' ? body.reason.trim() || null : null,
      });
    });

    if ('denied' in outcome) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: outcome.denied,
          message: 'You are not authorized to approve this enterprise profile configuration.',
        },
        { status: 403 },
      );
    }

    return NextResponse.json(outcome);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'ENTERPRISE_PROFILE_CONFIGURATION_APPROVAL_FAILED';
    const status =
      message === 'ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED'
        ? 409
        : message === 'ENTERPRISE_PROFILE_CONFIGURATION_REQUEST_NOT_FOUND'
          ? 404
          : 400;
    return NextResponse.json(
      {
        denied: true,
        reasonKey: message,
        message:
          message === 'ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED'
            ? 'A different authorized user must approve the enterprise profile configuration.'
            : 'This enterprise profile configuration cannot be approved in the selected workspace.',
      },
      { status },
    );
  }
}
