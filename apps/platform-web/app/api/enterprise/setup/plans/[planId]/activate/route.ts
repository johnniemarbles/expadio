import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { activateOrganizationSetup } from '@expadio/postgres-runtime/enterprise-onboarding';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../../../../../lib/governance-authz';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED',
          message: 'Select the active parent organization workspace to continue.',
        },
        { status: 403 },
      );
    }
    const parentOrganizationId = context.organizationId;

    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header is required' },
        { status: 400 },
      );
    }

    const { planId } = await params;
    const body = await request.json().catch(() => ({}));
    const outcome = await withTenantTransaction(context, async (client) => {
      if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
        return { forbidden: 'ENTERPRISE_SETUP_ACTIVATION_FORBIDDEN' } as const;
      }

      const target = await client.query<{
        organization_id: string;
        enterprise_id: string;
        state: string;
      }>(
        `SELECT plan.organization_id, plan.enterprise_id, plan.state
           FROM platform.organization_setup_plans plan
           JOIN platform.organization_closure closure
             ON closure.tenant_id = plan.tenant_id
            AND closure.ancestor_organization_id = $3::uuid
            AND closure.descendant_organization_id = plan.organization_id
            AND closure.depth > 0
          WHERE plan.tenant_id = $1::uuid
            AND plan.setup_plan_id = $2::uuid
          LIMIT 1`,
        [context.tenantId, planId, parentOrganizationId],
      );
      if (!target.rows[0]) {
        return { forbidden: 'ENTERPRISE_SETUP_PARENT_SCOPE_MISMATCH' } as const;
      }

      return activateOrganizationSetup(client, {
        tenantId: context.tenantId,
        setupPlanId: planId,
        activatedBySubjectId: context.subjectId,
        correlationId:
          request.headers.get('x-correlation-id')?.trim() || randomUUID(),
        idempotencyKey,
        reason: typeof body.reason === 'string' ? body.reason : null,
      });
    });

    if ('forbidden' in outcome) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: outcome.forbidden,
          message:
            outcome.forbidden === 'ENTERPRISE_SETUP_PARENT_SCOPE_MISMATCH'
              ? 'The selected organization is not an active ancestor of this setup plan.'
              : 'You are not authorized to activate this organization.',
        },
        { status: 403 },
      );
    }

    return NextResponse.json(outcome);
  } catch (error: any) {
    const setupConflicts = new Set([
      'ORGANIZATION_SETUP_NOT_READY_FOR_ACTIVATION',
      'ORGANIZATION_SETUP_READINESS_INVARIANT_FAILED',
      'ORGANIZATION_SETUP_ORGANIZATION_NOT_READY',
      'ORGANIZATION_SETUP_IDEMPOTENCY_CONFLICT',
    ]);
    if (setupConflicts.has(error?.message)) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: error.message,
          message: 'The organization has not satisfied its governed activation prerequisites.',
        },
        { status: 409 },
      );
    }
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
