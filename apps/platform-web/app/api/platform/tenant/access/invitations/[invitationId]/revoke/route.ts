import { randomUUID } from 'node:crypto';
import { clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { hasPlatformAdministrationRole } from '@/lib/governance-authz';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import {
  findTenantAccessInvitation,
  recordTenantInvitation,
  setTenantAccessInvitationStatus,
  upsertTenantAccessInvitation,
  TENANT_ACCESS_ROLE_KEYS,
  type TenantAccessRoleKey,
} from '@/lib/tenant-access';

function scopeOf(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const access = (metadata as any).expadioAccess;
  return access && typeof access === 'object' ? access as Record<string, unknown> : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ invitationId: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const organizationId = context.organizationId;
    if (!organizationId) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ORGANIZATION_REQUIRED', message: 'Select an organization workspace.' },
        { status: 400 },
      );
    }
    const { invitationId } = await params;
    const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID();

    const local = await withTenantTransaction(context, async (client) => {
      if (!(await hasPlatformAdministrationRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      return {
        invitation: await findTenantAccessInvitation(client, {
          tenantId: context.tenantId,
          organizationId,
          invitationId,
        }),
      } as const;
    });
    if ('forbidden' in local) {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Platform administration is required.' },
        { status: 403 },
      );
    }

    const clerk = await clerkClient();
    let roleKey = local.invitation?.roleKey ?? '';
    let email = local.invitation?.email ?? '';
    let clerkInvitation: any = null;

    if (!local.invitation) {
      const candidates = await clerk.invitations.getInvitationList({
        query: invitationId,
        limit: 100,
      });
      clerkInvitation = candidates.data.find((item) => item.id === invitationId) ?? null;
      const scope = scopeOf(clerkInvitation?.publicMetadata);
      roleKey = typeof scope?.roleKey === 'string' ? scope.roleKey.toUpperCase() : '';
      email = clerkInvitation?.emailAddress ?? '';
      if (
        !clerkInvitation
        || scope?.tenantId !== context.tenantId
        || scope?.organizationId !== organizationId
        || !TENANT_ACCESS_ROLE_KEYS.includes(roleKey as TenantAccessRoleKey)
      ) {
        return NextResponse.json(
          { denied: true, reasonKey: 'INVITATION_NOT_FOUND', message: 'Invitation was not found in this tenant workspace.' },
          { status: 404 },
        );
      }
      await withTenantTransaction(context, (client) =>
        upsertTenantAccessInvitation(client, {
          tenantId: context.tenantId,
          organizationId,
          invitationId,
          email,
          roleKey: roleKey as TenantAccessRoleKey,
          invitedBySubjectId: context.subjectId,
          correlationId,
          clerkCreatedAt: new Date(clerkInvitation.createdAt),
        })
      );
    }

    if (!TENANT_ACCESS_ROLE_KEYS.includes(roleKey as TenantAccessRoleKey)) {
      return NextResponse.json(
        { denied: true, reasonKey: 'INVITATION_ROLE_INVALID', message: 'Invitation role is not valid for this workspace.' },
        { status: 409 },
      );
    }

    let clerkRevoked = false;
    try {
      const revoked = await clerk.invitations.revokeInvitation(invitationId);
      clerkRevoked = revoked.status === 'revoked' || revoked.revoked === true;
    } catch (error) {
      const revokedList = await clerk.invitations.getInvitationList({
        status: 'revoked',
        query: invitationId,
        limit: 10,
      }).catch(() => ({ data: [] as any[] }));
      if (revokedList.data.some((item) => item.id === invitationId)) {
        clerkRevoked = true;
      } else {
        throw error;
      }
    }

    let auditPending = false;
    try {
      await withTenantTransaction(context, async (client) => {
        await setTenantAccessInvitationStatus(client, {
          tenantId: context.tenantId,
          organizationId,
          invitationId,
          status: 'REVOKED',
        });
        await recordTenantInvitation(client, {
          tenantId: context.tenantId,
          organizationId,
          invitationId,
          roleKey: roleKey as TenantAccessRoleKey,
          actorSubjectId: context.subjectId,
          correlationId,
          eventType: 'tenant.membership.invitation.revoked',
        });
      });
    } catch (error) {
      auditPending = true;
      console.error('Invitation revoked in Clerk but EXPADIO audit reconciliation failed', {
        invitationId,
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return NextResponse.json({
      success: clerkRevoked,
      invitationId,
      status: 'revoked',
      auditPending,
      message: auditPending
        ? 'Invitation was revoked in Clerk. EXPADIO audit reconciliation needs attention.'
        : 'Invitation revoked.',
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
