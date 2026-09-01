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
    const sourceInvitation = local.invitation;
    const roleKey = sourceInvitation.roleKey.toUpperCase();
    if (!TENANT_ACCESS_ROLE_KEYS.includes(roleKey as TenantAccessRoleKey)) {
      return NextResponse.json({ denied:true, reasonKey:'INVITATION_ROLE_INVALID', message:'Invitation role is invalid.' }, { status:409 });
    }
    const brandOrigin = loadBrandAppOrigin();
    if (!brandOrigin) {
      return NextResponse.json({ denied:true, reasonKey:'BRAND_APP_NOT_CONFIGURED', message:'Configure EXPADIO_BRAND_APP_URL before resending invitations.' }, { status:409 });
    }

    const clerk = await clerkClient();
    let oldInvitationInactive = false;
    try {
      const revoked = await clerk.invitations.revokeInvitation(invitationId);
      oldInvitationInactive = revoked.status === 'revoked' || revoked.revoked === true;
    } catch (revokeError) {
      const lookup = await clerk.invitations.getInvitationList({
        query: invitationId,
        limit: 10,
      }).catch(() => null);
      if (lookup === null) {
        return NextResponse.json(
          {
            denied: true,
            reasonKey: 'INVITATION_RESEND_PRECONDITION_UNVERIFIED',
            message: 'EXPADIO could not confirm the previous Clerk invitation state, so no replacement was created. Retry after Clerk is reachable.',
            correlationId,
          },
          { status: 502 },
        );
      }
      const current = lookup.data.find((item) => item.id === invitationId);
      if (current?.status === 'pending') {
        console.error('Invitation resend aborted because old Clerk invitation is still pending', {
          invitationId,
          correlationId,
          error: revokeError instanceof Error ? revokeError.message : String(revokeError),
        });
        return NextResponse.json(
          {
            denied: true,
            reasonKey: 'INVITATION_RESEND_REVOKE_FAILED',
            message: 'The previous Clerk invitation is still pending, so EXPADIO did not create a duplicate. Retry revoke or resend later.',
            correlationId,
          },
          { status: 502 },
        );
      }
      if (current?.status === 'accepted') {
        await withTenantTransaction(context, (client) =>
          setTenantAccessInvitationStatus(client, {
            tenantId: context.tenantId,
            organizationId,
            invitationId,
            status: 'ACCEPTED',
          })
        ).catch(() => undefined);
        return NextResponse.json(
          {
            denied: true,
            reasonKey: 'INVITATION_ALREADY_ACCEPTED',
            message: 'This invitation has already been accepted and cannot be resent.',
          },
          { status: 409 },
        );
      }
      if (current?.status === 'expired') {
        await withTenantTransaction(context, (client) =>
          setTenantAccessInvitationStatus(client, {
            tenantId: context.tenantId,
            organizationId,
            invitationId,
            status: 'EXPIRED',
          })
        ).catch(() => undefined);
        oldInvitationInactive = true;
      } else if (!current) {
        // getInvitationList() without a status returns non-revoked invitations.
        // A known invitation that is absent is therefore safe to treat as revoked.
        oldInvitationInactive = true;
      }
    }

    if (!oldInvitationInactive) {
      const lookup = await clerk.invitations.getInvitationList({
        query: invitationId,
        limit: 10,
      }).catch(() => null);
      const current = lookup?.data.find((item) => item.id === invitationId);
      if (current?.status === 'pending' || lookup === null) {
        return NextResponse.json(
          {
            denied: true,
            reasonKey: 'INVITATION_RESEND_PRECONDITION_UNVERIFIED',
            message: 'EXPADIO could not prove the previous invitation is inactive, so no replacement was created.',
            correlationId,
          },
          { status: 502 },
        );
      }
      if (current?.status === 'accepted') {
        return NextResponse.json(
          {
            denied: true,
            reasonKey: 'INVITATION_ALREADY_ACCEPTED',
            message: 'This invitation has already been accepted and cannot be resent.',
          },
          { status: 409 },
        );
      }
      oldInvitationInactive = true;
    }

    const replacement = await clerk.invitations.createInvitation({
      emailAddress: sourceInvitation.email,
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
          validUntil: sourceInvitation.validUntil,
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
          validUntil: sourceInvitation.validUntil ? new Date(sourceInvitation.validUntil) : null,
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
