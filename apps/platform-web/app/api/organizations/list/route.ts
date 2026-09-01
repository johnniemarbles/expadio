import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requestChildOrganization } from '@expadio/postgres-runtime/enterprise';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../../lib/governance-authz';
import { membershipRepository } from '../../../../lib/iam-adapter';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const memberships = await membershipRepository.listActiveMemberships({
      subjectId: context.subjectId,
      issuer: context.issuer ?? undefined,
      actorKind: 'user',
    } as any);
    const allowedOrganizationIds = [
      ...new Set(
        memberships
          .filter((membership) => membership.tenantId === context.tenantId)
          .map((membership) => membership.organizationId),
      ),
    ];

    const rows = await withTenantTransaction(context, async (client) => {
      if (allowedOrganizationIds.length === 0) return [];
      const result = await client.query(
        `SELECT
           organization.organization_id,
           organization.enterprise_id,
           organization.parent_organization_id,
           organization.organization_kind,
           organization.name,
           organization.status,
           organization.created_at,
           COUNT(membership.membership_id)::int AS members
         FROM platform.organizations organization
         LEFT JOIN platform.memberships membership
           ON membership.tenant_id = organization.tenant_id
          AND membership.organization_id = organization.organization_id
          AND membership.status = 'ACTIVE'
         WHERE organization.tenant_id = $1::uuid
           AND organization.organization_id = ANY($2::uuid[])
         GROUP BY
           organization.organization_id,
           organization.enterprise_id,
           organization.parent_organization_id,
           organization.organization_kind,
           organization.name,
           organization.status,
           organization.created_at
         ORDER BY organization.name ASC`,
        [context.tenantId, allowedOrganizationIds],
      );
      return result.rows;
    });

    return NextResponse.json(rows, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error: any) {
    if (error?.message === 'ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT') {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT',
          message: 'The Idempotency-Key was already used for a different enterprise request.',
        },
        { status: 409 },
      );
    }
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED',
          message: 'Select an organization workspace to continue.',
        },
        { status: 403 },
      );
    }

    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const organizationKind =
      typeof body.kind === 'string' && body.kind.trim() !== ''
        ? body.kind.trim()
        : 'BUSINESS';
    const requestedParent =
      typeof body.parentOrganizationId === 'string'
        ? body.parentOrganizationId
        : context.organizationId;

    if (name === '') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (requestedParent !== context.organizationId) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'ENTERPRISE_PARENT_SCOPE_MISMATCH',
          message: 'Create the request from the parent organization workspace.',
        },
        { status: 403 },
      );
    }

    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header is required' },
        { status: 400 },
      );
    }

    const correlationId =
      request.headers.get('x-correlation-id')?.trim() || randomUUID();

    const outcome = await withTenantTransaction(context, async (client) => {
      if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }

      const organization = await client.query<{ enterprise_id: string }>(
        `SELECT enterprise_id
           FROM platform.organizations
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid`,
        [context.tenantId, context.organizationId],
      );
      const enterpriseId = organization.rows[0]?.enterprise_id;
      if (!enterpriseId) throw new Error('ENTERPRISE_PROFILE_NOT_FOUND');

      return requestChildOrganization(client, {
        tenantId: context.tenantId,
        enterpriseId,
        parentOrganizationId: context.organizationId,
        approvingOrganizationId: context.organizationId,
        name,
        organizationKind,
        requestedBySubjectId: context.subjectId,
        correlationId,
        idempotencyKey,
      });
    });

    if ('forbidden' in outcome) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'ENTERPRISE_WRITE_FORBIDDEN',
          message: 'You are not authorized to request enterprise structure changes.',
        },
        { status: 403 },
      );
    }

    return NextResponse.json(outcome, { status: outcome.idempotent ? 200 : 202 });
  } catch (error) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
