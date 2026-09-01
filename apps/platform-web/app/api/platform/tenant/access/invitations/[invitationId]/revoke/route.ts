import { randomUUID } from 'node:crypto';
import { clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { hasPlatformAdministrationRole } from '@/lib/governance-authz';
import {
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import {
  recordTenantInvitation,
  TENANT_ACCESS_ROLE_KEYS,
  type TenantAccessRoleKey,
} from '@/lib/tenant-access';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ invitationId: string }> },
) {
  const context = await resolveRequestContext(request);
  const organizationId = context.organizationId;
  if (!organizationId) {
    return NextResponse.json(
      { denied: true, reasonKey: 'ORGANIZATION_REQUIRED', message: 'Select an organization workspace.' },
      { status: 400 },
    );
  }
  const { invitationId } = await params;
  const allowed = await withTenantTransaction(context, async (client) =>
    hasPlatformAdministrationRole(client, context.subjectId)
  );
  if (!allowed) {
    return NextResponse.json(
      { denied: true, reasonKey: 'FORBIDDEN', message: 'Platform administration is required.' },
      { status: 403 },
    );
  }

  const clerk = await clerkClient();
  const invitations = await clerk.invitations.getInvitationList({ query: invitationId, limit: 10 });
  const invitation = invitations.data.find((item) => item.id === invitationId);
  const scope = invitation?.publicMetadata && typeof invitation.publicMetadata === 'object'
    ? (invitation.publicMetadata as any).expadioAccess
    : null;
  const roleKey = typeof scope?.roleKey === 'string' ? scope.roleKey.toUpperCase() : '';
  if (
    !invitation
    || scope?.tenantId !== context.tenantId
    || scope?.organizationId !== organizationId
    || !TENANT_ACCESS_ROLE_KEYS.includes(roleKey as TenantAccessRoleKey)
  ) {
    return NextResponse.json(
      { denied: true, reasonKey: 'INVITATION_NOT_FOUND', message: 'Invitation was not found in this tenant workspace.' },
      { status: 404 },
    );
  }

  await clerk.invitations.revokeInvitation(invitationId);
  await withTenantTransaction(context, (client) =>
    recordTenantInvitation(client, {
      tenantId: context.tenantId,
      organizationId,
      invitationId,
      roleKey: roleKey as TenantAccessRoleKey,
      actorSubjectId: context.subjectId,
      correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      eventType: 'tenant.membership.invitation.revoked',
    })
  );
  return NextResponse.json({ success: true });
}
