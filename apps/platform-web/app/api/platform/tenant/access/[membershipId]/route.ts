import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { hasPlatformAdministrationRole } from '../../../../../../lib/governance-authz';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../../../lib/request-context';
import {
  replaceTenantMembershipRoles,
  setTenantMembershipStatus,
  TENANT_ACCESS_ROLE_KEYS,
  type TenantAccessRoleKey,
} from '../../../../../../lib/tenant-access';

export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ membershipId: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const { membershipId } = await params;
    const body = await request.json() as Record<string, unknown>;
    const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID();

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasPlatformAdministrationRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }

      if (Array.isArray(body.roleKeys)) {
        const roleKeys = body.roleKeys
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim().toUpperCase())
          .filter((value): value is TenantAccessRoleKey =>
            TENANT_ACCESS_ROLE_KEYS.includes(value as TenantAccessRoleKey)
          );
        const target = await client.query<{ subject_id: string }>(
          `SELECT subject_id FROM platform.memberships
            WHERE tenant_id = $1::uuid AND organization_id = $2::uuid
              AND membership_id = $3::uuid LIMIT 1`,
          [context.tenantId, context.organizationId, membershipId],
        );
        if (!target.rows[0]) throw new Error('TENANT_MEMBERSHIP_NOT_FOUND');
        await replaceTenantMembershipRoles(client, {
          tenantId: context.tenantId,
          organizationId: context.organizationId,
          subjectId: target.rows[0].subject_id,
          roleKeys,
          actorSubjectId: context.subjectId,
          correlationId,
        });
      }

      if (typeof body.status === 'string') {
        const status = body.status.trim().toUpperCase();
        if (!['ACTIVE', 'SUSPENDED', 'REVOKED'].includes(status)) {
          throw new Error('TENANT_MEMBERSHIP_STATUS_INVALID');
        }
        return {
          membership: await setTenantMembershipStatus(client, {
            tenantId: context.tenantId,
            organizationId: context.organizationId,
            membershipId,
            status: status as 'ACTIVE' | 'SUSPENDED' | 'REVOKED',
            actorSubjectId: context.subjectId,
            correlationId,
          }),
        } as const;
      }

      return { membership: null } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Platform administration is required.' },
        { status: 403 },
      );
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error: any) {
    const known = new Set([
      'TENANT_MEMBERSHIP_NOT_FOUND',
      'TENANT_MEMBERSHIP_STATUS_INVALID',
      'TENANT_MEMBERSHIP_REVOKED_REQUIRES_NEW_GRANT',
      'TENANT_ACCESS_ROLE_REQUIRED',
      'TENANT_ACCESS_ROLE_NOT_CONFIGURED',
    ]);
    if (error instanceof Error && known.has(error.message)) {
      return NextResponse.json(
        { denied: true, reasonKey: error.message, message: error.message.replaceAll('_', ' ').toLowerCase() },
        { status: error.message === 'TENANT_MEMBERSHIP_NOT_FOUND' ? 404 : 409 },
      );
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
