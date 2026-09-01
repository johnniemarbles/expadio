import { NextResponse } from 'next/server';
import { approveCreateOrganizationRequest } from '@expadio/postgres-runtime/enterprise';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../../../lib/request-context';
import { hasGovernanceWriteRoleForOrganization } from '../../../../../../lib/governance-authz';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED',
          message: 'Select the approving organization workspace to continue.',
        },
        { status: 403 },
      );
    }

    const body = await request.json();
    if (body.action !== 'APPROVE') {
      return NextResponse.json(
        { error: 'Only APPROVE is implemented in this foundation slice.' },
        { status: 400 },
      );
    }

    const { id } = await params;
    const outcome = await withTenantTransaction(context, async (client) => {
      if (!(await hasGovernanceWriteRoleForOrganization(client, context.subjectId, context.organizationId!))) {
        return { forbidden: true } as const;
      }
      return approveCreateOrganizationRequest(client, {
        tenantId: context.tenantId,
        requestId: id,
        approverOrganizationId: context.organizationId!,
        decidedBySubjectId: context.subjectId,
        decisionReason:
          typeof body.reason === 'string' && body.reason.trim() !== ''
            ? body.reason.trim()
            : null,
        allowSelfApproval: false,
        decidedByIssuer: context.issuer ?? null,
      });
    });

    if ('forbidden' in outcome) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'ENTERPRISE_DECISION_FORBIDDEN',
          message: 'You are not authorized to decide enterprise structure requests.',
        },
        { status: 403 },
      );
    }

    return NextResponse.json(outcome);
  } catch (error: any) {
    const known = new Set([
      'ENTERPRISE_CHANGE_REQUEST_NOT_FOUND',
      'ENTERPRISE_CHANGE_REQUEST_OPERATION_UNSUPPORTED',
      'ENTERPRISE_CHANGE_REQUEST_NOT_APPROVABLE',
      'ENTERPRISE_APPROVER_SCOPE_MISMATCH',
      'ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED',
      'ENTERPRISE_CHANGE_REQUEST_PAYLOAD_INVALID',
    ]);
    if (known.has(error?.message)) {
      const status =
        error.message === 'ENTERPRISE_CHANGE_REQUEST_NOT_FOUND'
          ? 404
          : error.message === 'ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED'
            ? 409
            : 403;
      return NextResponse.json(
        {
          denied: true,
          reasonKey: error.message,
          message: error.message === 'ENTERPRISE_SEPARATION_OF_DUTIES_REQUIRED'
            ? 'The requester cannot perform the final approval for this enterprise change.'
            : 'This enterprise change request cannot be approved in the selected scope.',
        },
        { status },
      );
    }
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
