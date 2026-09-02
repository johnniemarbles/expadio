import { NextResponse } from 'next/server';
import { approveCreateOrganizationRequest } from '@expadio/postgres-runtime/enterprise';
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
    const body = await request.json().catch(() => ({}));

    const outcome = await withBrandTransaction(context, async (client) => {
      if (
        !(await hasBrandGovernanceForOrganization(
          client,
          context.subjectId,
          context.organizationId,
        ))
      ) {
        return { denied: 'ENTERPRISE_DECISION_FORBIDDEN' } as const;
      }
      return approveCreateOrganizationRequest(client, {
        tenantId: context.tenantId,
        requestId: id,
        approverOrganizationId: context.organizationId,
        decidedBySubjectId: context.subjectId,
        decisionReason: typeof body.reason === 'string' ? body.reason.trim() || null : null,
        allowSelfApproval: false,
        decidedByIssuer: context.issuer,
      });
    });

    if ('denied' in outcome) {
      return NextResponse.json(
        { denied: true, reasonKey: outcome.denied, message: 'You are not authorized to approve enterprise structure requests.' },
        { status: 403 },
      );
    }
    return NextResponse.json(outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ENTERPRISE_APPROVAL_FAILED';
    const status =
      message === 'ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED'
        ? 409
        : message === 'ENTERPRISE_CHANGE_REQUEST_NOT_FOUND'
          ? 404
          : 403;
    return NextResponse.json(
      {
        denied: true,
        reasonKey: message,
        message:
          message === 'ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED'
            ? 'A different authorized user must approve this onboarding request.'
            : 'This onboarding request cannot be approved in the selected Brand workspace.',
      },
      { status },
    );
  }
}
