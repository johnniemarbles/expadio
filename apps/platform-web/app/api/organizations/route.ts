import { NextResponse } from 'next/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import type { PlatformOrganization } from '../../../lib/contracts';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../lib/request-context';
import { membershipRepository } from '../../../lib/iam-adapter';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const url = new URL(request.url);
    const requestedId = url.searchParams.get('id') || context.organizationId;
    if (!requestedId) {
      const denied: DeniedResult = {
        denied: true,
        reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED',
        message: 'Select an organization workspace to continue.',
      };
      return NextResponse.json(denied, { status: 403 });
    }

    const memberships = await membershipRepository.listActiveMemberships({
      subjectId: context.subjectId,
      issuer: context.issuer ?? undefined,
      actorKind: 'user',
    } as any);
    const allowed = memberships.some(
      (membership) =>
        membership.tenantId === context.tenantId &&
        membership.organizationId === requestedId,
    );
    if (!allowed) {
      const denied: DeniedResult = {
        denied: true,
        reasonKey: 'ORGANIZATION_ACCESS_DENIED',
        message: 'You do not have access to this organization.',
      };
      return NextResponse.json(denied, { status: 403 });
    }

    const row = await withTenantTransaction(context, async (client) => {
      const result = await client.query(
        `SELECT organization_id, enterprise_id, name, parent_organization_id,
                organization_kind, status
           FROM platform.organizations
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid`,
        [context.tenantId, requestedId],
      );
      return result.rows[0] as any;
    });

    if (!row) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ORGANIZATION_NOT_FOUND' } satisfies DeniedResult,
        { status: 404 },
      );
    }

    const organization: PlatformOrganization = {
      id: row.organization_id,
      name: row.name,
      environment: row.organization_kind,
      level: 'organization',
      parentId: row.parent_organization_id ?? null,
    };

    return NextResponse.json(organization, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
