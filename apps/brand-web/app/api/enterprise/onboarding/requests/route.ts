import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requestChildOrganization } from '@expadio/postgres-runtime/enterprise';
import {
  hasBrandGovernanceForOrganization,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../../lib/brand-context';
import { loadBrandOnboardingPortfolio } from '../../../../../lib/enterprise-onboarding';

export async function GET() {
  try {
    const context = await resolveBrandContext();
    const result = await withBrandTransaction(
      context,
      (client) => loadBrandOnboardingPortfolio(client, context),
    );
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'ENTERPRISE_ONBOARDING_LOAD_FAILED' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const kind = typeof body.kind === 'string' && body.kind.trim() ? body.kind.trim() : 'BUSINESS';
    if (!name) return NextResponse.json({ error: 'Organization name is required.' }, { status: 400 });

    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey) {
      return NextResponse.json({ error: 'Idempotency-Key header is required.' }, { status: 400 });
    }

    const outcome = await withBrandTransaction(context, async (client) => {
      if (
        !(await hasBrandGovernanceForOrganization(
          client,
          context.subjectId,
          context.organizationId,
        ))
      ) {
        return { denied: 'ENTERPRISE_WRITE_FORBIDDEN' } as const;
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

      return requestChildOrganization(client, {
        tenantId: context.tenantId,
        enterpriseId,
        parentOrganizationId: context.organizationId,
        approvingOrganizationId: context.organizationId,
        name,
        organizationKind: kind,
        requestedBySubjectId: context.subjectId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
        idempotencyKey,
      });
    });

    if ('denied' in outcome) {
      return NextResponse.json(
        { denied: true, reasonKey: outcome.denied, message: 'You are not authorized to onboard an organization from this workspace.' },
        { status: 403 },
      );
    }
    return NextResponse.json(outcome, { status: outcome.idempotent ? 200 : 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ENTERPRISE_ONBOARDING_REQUEST_FAILED';
    return NextResponse.json(
      {
        error: message,
        message:
          message === 'ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT'
            ? 'This request key was already used for a different organization.'
            : 'The organization onboarding request could not be created.',
      },
      { status: message === 'ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT' ? 409 : 500 },
    );
  }
}
