import { NextResponse } from 'next/server';
import { approveCreateOrganizationRequest } from '@expadio/postgres-runtime/enterprise';
import { decideEnterpriseOwnershipChange } from '@expadio/postgres-runtime/enterprise-ownership';
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
    const action =
      body.action === 'APPROVE'
        ? 'APPROVE'
        : body.action === 'REJECT'
          ? 'REJECT'
          : null;
    if (!action) {
      return NextResponse.json(
        { error: 'Action must be APPROVE or REJECT.' },
        { status: 400 },
      );
    }

    const { id } = await params;
    const outcome = await withTenantTransaction(context, async (client) => {
      if (!(await hasGovernanceWriteRoleForOrganization(client, context.subjectId, context.organizationId!))) {
        return { forbidden: true } as const;
      }

      const requestType = await client.query<{ operation: string }>(
        `SELECT operation
           FROM platform.enterprise_change_requests
          WHERE tenant_id = $1::uuid
            AND enterprise_change_request_id = $2::uuid
          LIMIT 1`,
        [context.tenantId, id],
      );
      const operation = requestType.rows[0]?.operation;
      if (!operation) throw new Error('ENTERPRISE_CHANGE_REQUEST_NOT_FOUND');

      const decisionReason =
        typeof body.reason === 'string' && body.reason.trim() !== ''
          ? body.reason.trim()
          : null;

      if (operation === 'CHANGE_OWNERSHIP') {
        return {
          ownership: await decideEnterpriseOwnershipChange(client, {
            tenantId: context.tenantId,
            requestId: id,
            approverOrganizationId: context.organizationId!,
            decidedBySubjectId: context.subjectId,
            action,
            decisionReason,
          }),
        } as const;
      }

      if (operation === 'CREATE_ORGANIZATION') {
        if (action !== 'APPROVE') {
          throw new Error('ENTERPRISE_CHANGE_REQUEST_REJECTION_UNSUPPORTED');
        }
        return approveCreateOrganizationRequest(client, {
          tenantId: context.tenantId,
          requestId: id,
          approverOrganizationId: context.organizationId!,
          decidedBySubjectId: context.subjectId,
          decisionReason,
          allowSelfApproval: false,
          decidedByIssuer: context.issuer ?? null,
        });
      }

      throw new Error('ENTERPRISE_CHANGE_REQUEST_OPERATION_UNSUPPORTED');
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
      'ENTERPRISE_CHANGE_REQUEST_REJECTION_UNSUPPORTED',
      'ENTERPRISE_OWNERSHIP_INTEREST_NOT_FOUND',
      'ENTERPRISE_OWNERSHIP_INTEREST_NOT_PENDING',
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
