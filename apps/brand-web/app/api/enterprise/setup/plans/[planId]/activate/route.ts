import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { activateOrganizationSetup } from '@expadio/postgres-runtime/enterprise-onboarding';
import {
  hasBrandGovernanceForOrganization,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../../../../lib/brand-context';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const { planId } = await params;
    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header is required.' },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const result = await withBrandTransaction(context, async (client) => {
      if (
        !(await hasBrandGovernanceForOrganization(
          client,
          context.subjectId,
          context.organizationId,
        ))
      ) {
        return { denied: 'ENTERPRISE_SETUP_ACTIVATION_FORBIDDEN' } as const;
      }

      const descendant = await client.query<{
        organization_id: string;
        state: string;
      }>(
        `SELECT setup.organization_id, setup.state
           FROM platform.organization_setup_plans setup
           JOIN platform.organization_closure closure
             ON closure.tenant_id = setup.tenant_id
            AND closure.ancestor_organization_id = $3::uuid
            AND closure.descendant_organization_id = setup.organization_id
            AND closure.depth > 0
          WHERE setup.tenant_id = $1::uuid
            AND setup.setup_plan_id = $2::uuid
          LIMIT 1`,
        [context.tenantId, planId, context.organizationId],
      );
      if (!descendant.rows[0]) {
        return { denied: 'ENTERPRISE_SETUP_PARENT_SCOPE_MISMATCH' } as const;
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

    if ('denied' in result) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: result.denied,
          message:
            result.denied === 'ENTERPRISE_SETUP_PARENT_SCOPE_MISMATCH'
              ? 'The selected Brand organization is not an active ancestor of this setup plan.'
              : 'You are not authorized to activate this organization.',
        },
        { status: 403 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ENTERPRISE_SETUP_ACTIVATION_FAILED';
    const conflicts = new Set([
      'ORGANIZATION_SETUP_NOT_READY_FOR_ACTIVATION',
      'ORGANIZATION_SETUP_READINESS_INVARIANT_FAILED',
      'ORGANIZATION_SETUP_ORGANIZATION_NOT_READY',
      'ORGANIZATION_SETUP_IDEMPOTENCY_CONFLICT',
      'ORGANIZATION_SETUP_PRIMARY_ADMIN_REQUIRED',
      'ORGANIZATION_SETUP_ACCESS_HANDOFF_CONFLICT',
    ]);
    return NextResponse.json(
      {
        denied: true,
        reasonKey: message,
        message: conflicts.has(message)
          ? 'The organization has not satisfied its governed activation prerequisites.'
          : 'The organization could not be activated.',
      },
      { status: conflicts.has(message) ? 409 : 500 },
    );
  }
}
