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
  grantTenantMembership,
  listTenantMemberships,
  recordTenantInvitation,
  TENANT_ACCESS_ROLE_KEYS,
  type TenantAccessRoleKey,
} from '@/lib/tenant-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISSUER = 'https://clerk.expadio.com';

function role(value: unknown): TenantAccessRoleKey | null {
  const key = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return TENANT_ACCESS_ROLE_KEYS.includes(key as TenantAccessRoleKey)
    ? key as TenantAccessRoleKey
    : null;
}

function invitationScope(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const access = (metadata as any).expadioAccess;
  return access && typeof access === 'object' ? access as Record<string, unknown> : null;
}

type ClerkApiErrorItem = {
  code?: string;
  message?: string;
  longMessage?: string;
};


function tenantAccessErrorResponse(error: unknown, correlationId: string): NextResponse | null {
  if (!(error instanceof Error)) return null;
  const safe = new Map<string, { status: number; message: string }>([
    ['TENANT_ACCESS_WINDOW_INVALID', { status: 400, message: 'Access expiry must be in the future.' }],
    ['TENANT_ACCESS_ORGANIZATION_INVALID', { status: 409, message: 'The selected organization is not active for this tenant.' }],
    ['TENANT_ACCESS_ROLE_NOT_CONFIGURED', { status: 409, message: 'The selected tenant role is not configured for this tenant.' }],
    ['TENANT_ACCESS_WRITE_FAILED', { status: 500, message: 'EXPADIO could not persist the tenant access grant.' }],
  ]);
  const mapped = safe.get(error.message);
  if (!mapped) return null;
  console.error('Tenant access operation failed', { reasonKey: error.message, correlationId });
  return NextResponse.json(
    { denied: true, reasonKey: error.message, message: mapped.message, correlationId },
    { status: mapped.status },
  );
}

function clerkInvitationErrorResponse(error: unknown): NextResponse | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { status?: unknown; errors?: unknown };
  if (!Array.isArray(candidate.errors) || candidate.errors.length === 0) return null;

  const first = candidate.errors[0] as ClerkApiErrorItem;
  const code = typeof first?.code === 'string' ? first.code : 'clerk_api_error';
  const rawMessage =
    (typeof first?.longMessage === 'string' && first.longMessage)
    || (typeof first?.message === 'string' && first.message)
    || 'Clerk could not create the invitation.';

  let status = typeof candidate.status === 'number' ? candidate.status : 502;
  let reasonKey = 'CLERK_INVITATION_FAILED';
  let message = rawMessage;

  if (code === 'duplicate_record') {
    status = 409;
    reasonKey = 'INVITATION_ALREADY_PENDING';
    message = 'This email already has a pending Clerk invitation. Revoke the existing invitation or let the user accept it.';
  } else if (code === 'invitations_not_supported') {
    status = 409;
    reasonKey = 'CLERK_INVITATIONS_NOT_SUPPORTED';
    message = 'Clerk invitations are not enabled for this application configuration.';
  } else if (status === 429) {
    reasonKey = 'CLERK_INVITATION_RATE_LIMITED';
    message = 'Clerk invitation rate limit reached. Try again later.';
  } else if (status === 401 || status === 403) {
    status = 502;
    reasonKey = 'CLERK_BACKEND_AUTH_FAILED';
    message = 'Platform could not authenticate to the Clerk Backend API. Check the Platform Clerk secret key.';
  } else if (status < 400 || status > 599) {
    status = 502;
  }

  console.error('Clerk invitation API error', { code, status, reasonKey });
  return NextResponse.json({ denied: true, reasonKey, message }, { status });
}


export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const organizationId = context.organizationId;
    if (!organizationId) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ORGANIZATION_REQUIRED', message: 'Select an organization workspace.' },
        { status: 400 },
      );
    }
    const db = await withTenantTransaction(context, async (client) => {
      if (!(await hasPlatformAdministrationRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      return {
        members: await listTenantMemberships(client, {
          tenantId: context.tenantId,
          organizationId,
        }),
      } as const;
    });
    if ('forbidden' in db) {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Platform administration is required.' },
        { status: 403 },
      );
    }

    const client = await clerkClient();
    const subjectIds = [...new Set(db.members.map((member) => member.subjectId))].slice(0, 100);
    const users = subjectIds.length
      ? (await client.users.getUserList({ userId: subjectIds, limit: 100 })).data
      : [];
    const userMap = new Map(users.map((user) => [
      user.id,
      {
        name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
        email: user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)?.emailAddress
          ?? user.emailAddresses[0]?.emailAddress
          ?? null,
        imageUrl: user.imageUrl,
      },
    ]));

    const pending = await client.invitations.getInvitationList({ status: 'pending', limit: 100 });
    const invitations = pending.data.flatMap((invitation) => {
      const scope = invitationScope(invitation.publicMetadata);
      if (
        scope?.tenantId !== context.tenantId
        || scope?.organizationId !== organizationId
      ) return [];
      return [{
        invitationId: invitation.id,
        email: invitation.emailAddress,
        roleKey: typeof scope.roleKey === 'string' ? scope.roleKey : null,
        status: invitation.status,
        createdAt: new Date(invitation.createdAt).toISOString(),
      }];
    });

    return NextResponse.json({
      members: db.members.map((member) => ({
        ...member,
        identity: userMap.get(member.subjectId) ?? { name: null, email: null, imageUrl: null },
      })),
      invitations,
      roleKeys: TENANT_ACCESS_ROLE_KEYS,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const organizationId = context.organizationId;
    if (!organizationId) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ORGANIZATION_REQUIRED', message: 'Select an organization workspace.' },
        { status: 400 },
      );
    }
    const body = await request.json() as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const roleKey = role(body.roleKey);
    if (!email || !email.includes('@') || !roleKey) {
      return NextResponse.json(
        { denied: true, reasonKey: 'TENANT_ACCESS_INPUT_INVALID', message: 'A valid email and tenant role are required.' },
        { status: 400 },
      );
    }
    let validUntil: Date | null = null;
    if (typeof body.validUntil === 'string' && body.validUntil.trim()) {
      validUntil = new Date(body.validUntil);
      if (!Number.isFinite(validUntil.getTime()) || validUntil.getTime() <= Date.now()) {
        return NextResponse.json(
          { denied: true, reasonKey: 'TENANT_ACCESS_WINDOW_INVALID', message: 'Access expiry must be in the future.' },
          { status: 400 },
        );
      }
    }

    const permitted = await withTenantTransaction(context, async (client) =>
      hasPlatformAdministrationRole(client, context.subjectId)
    );
    if (!permitted) {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Platform administration is required.' },
        { status: 403 },
      );
    }

    const clerk = await clerkClient();
    const existing = await clerk.users.getUserList({ emailAddress: [email], limit: 2 });
    const correlationId = request.headers.get('x-correlation-id')?.trim() || randomUUID();

    if (existing.data[0]) {
      const membership = await withTenantTransaction(context, async (client) =>
        grantTenantMembership(client, {
          tenantId: context.tenantId,
          organizationId,
          subjectId: existing.data[0]!.id,
          issuer: ISSUER,
          roleKey,
          validUntil,
          actorSubjectId: context.subjectId,
          correlationId,
        })
      );
      return NextResponse.json({ outcome: 'MEMBERSHIP_GRANTED', membership }, { status: 201 });
    }

    const brandOrigin = loadBrandAppOrigin();
    if (!brandOrigin) {
      return NextResponse.json(
        { denied: true, reasonKey: 'BRAND_APP_NOT_CONFIGURED', message: 'Configure EXPADIO_BRAND_APP_URL before inviting Brand users.' },
        { status: 409 },
      );
    }

    const pendingForEmail = await clerk.invitations.getInvitationList({
      status: 'pending',
      query: email,
      limit: 100,
    });
    const pendingEmailInvitations = pendingForEmail.data.filter((item) =>
      item.emailAddress.toLowerCase() === email
    );
    const existingInvitation = pendingEmailInvitations.find((item) =>
      invitationScope(item.publicMetadata)?.tenantId === context.tenantId
      && invitationScope(item.publicMetadata)?.organizationId === organizationId
    );

    if (existingInvitation) {
      return NextResponse.json({
        outcome: 'INVITATION_ALREADY_PENDING',
        invitation: {
          invitationId: existingInvitation.id,
          email: existingInvitation.emailAddress,
          status: existingInvitation.status,
        },
        message: 'This user already has a pending invitation for the selected Brand workspace.',
      });
    }

    const conflictingInvitation = pendingEmailInvitations[0];
    if (conflictingInvitation) {
      const scope = invitationScope(conflictingInvitation.publicMetadata);
      const reasonKey = scope
        ? 'INVITATION_PENDING_OTHER_WORKSPACE'
        : 'INVITATION_PENDING_UNSCOPED';
      const message = scope
        ? 'This email already has a pending Clerk invitation for another EXPADIO workspace. Manage that invitation from its workspace, or revoke it in Clerk before inviting the user here.'
        : 'This email already has a pending Clerk invitation that is not linked to an EXPADIO workspace. Revoke the legacy invitation in Clerk, then invite the user again from EXPADIO.';
      return NextResponse.json(
        { denied: true, reasonKey, message },
        { status: 409 },
      );
    }

    let invitation;
    try {
      invitation = await clerk.invitations.createInvitation({
        emailAddress: email,
        redirectUrl: new URL('/sign-up', brandOrigin).toString(),
        expiresInDays: 14,
        publicMetadata: {
          expadioAccess: {
            version: 1,
            tenantId: context.tenantId,
            organizationId,
            roleKey,
            invitedBySubjectId: context.subjectId,
            issuer: ISSUER,
            validUntil: validUntil?.toISOString() ?? null,
          },
        },
      });
    } catch (error) {
      const response = clerkInvitationErrorResponse(error);
      if (response) return response;
      throw error;
    }

    try {
      await withTenantTransaction(context, (client) =>
        recordTenantInvitation(client, {
          tenantId: context.tenantId,
          organizationId,
          invitationId: invitation.id,
          roleKey,
          actorSubjectId: context.subjectId,
          correlationId,
        })
      );
    } catch (auditError) {
      console.error('Invitation audit persistence failed', {
        invitationId: invitation.id,
        correlationId,
        error: auditError instanceof Error ? auditError.message : String(auditError),
      });
      try {
        await clerk.invitations.revokeInvitation(invitation.id);
      } catch (revokeError) {
        console.error('CRITICAL: invitation audit failed and compensation revoke failed', {
          invitationId: invitation.id,
          correlationId,
          error: revokeError instanceof Error ? revokeError.message : String(revokeError),
        });
        return NextResponse.json(
          {
            denied: true,
            reasonKey: 'INVITATION_STATE_UNCERTAIN',
            message: 'The invitation may have been created, but EXPADIO could not persist its audit record or confirm rollback. Check Clerk pending invitations before retrying.',
            correlationId,
          },
          { status: 500 },
        );
      }
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'INVITATION_AUDIT_FAILED_ROLLED_BACK',
          message: 'Clerk created the invitation, but EXPADIO could not persist its audit record. The invitation was revoked automatically; retry after checking Platform logs.',
          correlationId,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      outcome: 'INVITATION_SENT',
      invitation: {
        invitationId: invitation.id,
        email: invitation.emailAddress,
        status: invitation.status,
      },
    }, { status: 202 });
  } catch (error: any) {
    const correlationId =
      request.headers.get('x-correlation-id')?.trim()
      || (error && typeof error === 'object' && typeof error.correlationId === 'string' ? error.correlationId : randomUUID());
    const accessResponse = tenantAccessErrorResponse(error, correlationId);
    if (accessResponse) return accessResponse;
    const clerkResponse = clerkInvitationErrorResponse(error);
    if (clerkResponse) return clerkResponse;
    console.error('Unhandled tenant invitation failure', {
      correlationId,
      error: error instanceof Error ? error.message : String(error),
    });
    const { body, status } = deniedResponse(error);
    return NextResponse.json({ ...body, correlationId }, { status });
  }
}
