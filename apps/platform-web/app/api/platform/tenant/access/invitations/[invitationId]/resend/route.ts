import { randomUUID } from 'node:crypto';
import { clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { hasPlatformAdministrationRole } from '@/lib/governance-authz';
import { loadBrandAppOrigin } from '@/lib/brand-app';
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ invitationId: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const organizationId = context.organizationId;
    if (!organizationId) {
      return NextResponse.json({ denied:true, reasonKey:'ORGANIZATION_REQUIRED', message:'Select an organization workspace.' }, { status:400 });
    }
    const { invitationId } = await params;
    const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID();
    const local = await withTenantTransaction(context, async (client) => {
      if (!(await hasPlatformAdministrationRole(client, context.subjectId))) return { forbidden:true } as const;
      return {
        invitation: await findTenantAccessInvitation(client, {
          tenantId: context.tenantId,
          organizationId,
          invitationId,
        }),
      } as const;
    });
    if ('forbidden' in local) {
      return NextResponse.json({ denied:true, reasonKey:'FORBIDDEN', message:'Platform administration is required.' }, { status:403 });
    }
    if (!local.invitation || local.invitation.status !== 'PENDING') {
      return NextResponse.json({ denied:true, reasonKey:'INVITATION_NOT_PENDING', message:'Only a pending EXPADIO invitation can be resent.' }, { status:409 });
    }
    const roleKey = local.invitation.roleKey.toUpperCase();
    if (!TENANT_ACCESS_ROLE_KEYS.includes(roleKey as TenantAccessRoleKey)) {
      return NextResponse.json({ denied:true, reasonKey:'INVITATION_ROLE_INVALID', message:'Invitation role is invalid.' }, { status:409 });
    }
    const brandOrigin = loadBrandAppOrigin();
    if (!brandOrigin) {
      return NextResponse.json({ denied:true, reasonKey:'BRAND_APP_NOT_CONFIGURED', message:'Configure EXPADIO_BRAND_APP_URL before resending invitations.' }, { status:409 });
    }

    const clerk = await clerkClient();
    try {
      await clerk.invitations.revokeInvitation(invitationId);
    } catch {
      // Resend is allowed when the previous Clerk invitation is already no longer active.
    }

    const replacement = await clerk.invitations.createInvitation({
      emailAddress: local.invitation.email,
      redirectUrl: new URL('/sign-up', brandOrigin).toString(),
      expiresInDays: 14,
      notify: true,
      templateSlug: 'invitation',
      publicMetadata: {
        expadioAccess: {
          version: 1,
          tenantId: context.tenantId,
          organizationId,
          roleKey,
          invitedBySubjectId: context.subjectId,
          issuer: 'https://clerk.expadio.com',
          validUntil: local.invitation.validUntil,
        },
      },
    });

    try {
      await withTenantTransaction(context, async (client) => {
        await setTenantAccessInvitationStatus(client, {
          tenantId: context.tenantId,
          organizationId,
          invitationId,
          status: 'REVOKED',
        });
        const createdAt = new Date(replacement.createdAt);
        await upsertTenantAccessInvitation(client, {
          tenantId: context.tenantId,
          organizationId,
          invitationId: replacement.id,
          email: replacement.emailAddress,
          roleKey: roleKey as TenantAccessRoleKey,
          invitedBySubjectId: context.subjectId,
          correlationId,
          validUntil: local.invitation.validUntil ? new Date(local.invitation.validUntil) : null,
          clerkCreatedAt: createdAt,
          clerkExpiresAt: new Date(createdAt.getTime() + 14 * 24 * 60 * 60 * 1000),
        });
        await recordTenantInvitation(client, {
          tenantId: context.tenantId,
          organizationId,
          invitationId: replacement.id,
          roleKey: roleKey as TenantAccessRoleKey,
          actorSubjectId: context.subjectId,
          correlationId,
        });
      });
    } catch (error) {
      console.error('Resent Clerk invitation created but EXPADIO reconciliation failed', {
        oldInvitationId: invitationId,
        newInvitationId: replacement.id,
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return NextResponse.json({
      success: true,
      invitation: {
        invitationId: replacement.id,
        email: replacement.emailAddress,
        roleKey,
        status: replacement.status,
        createdAt: new Date(replacement.createdAt).toISOString(),
        acceptUrl: typeof replacement.url === 'string' ? replacement.url : null,
        deliveryState: 'EMAIL_REQUESTED',
      },
      message: 'A fresh Clerk invitation was created and email delivery was explicitly requested.',
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
