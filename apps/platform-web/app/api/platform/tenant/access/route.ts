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
    const clerkResponse = clerkInvitationErrorResponse(error);
    if (clerkResponse) return clerkResponse;
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
    const existingInvitation = pendingForEmail.data.find((item) =>
      item.emailAddress.toLowerCase() === email
      && invitationScope(item.publicMetadata)?.tenantId === context.tenantId
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

    return NextResponse.json({
      outcome: 'INVITATION_SENT',
      invitation: {
        invitationId: invitation.id,
        email: invitation.emailAddress,
        status: invitation.status,
      },
    }, { status: 202 });
  } catch (error: any) {
    if (error instanceof Error && error.message === 'TENANT_ACCESS_ROLE_NOT_CONFIGURED') {
      return NextResponse.json(
        { denied: true, reasonKey: error.message, message: 'The selected tenant role is not configured for this tenant.' },
        { status: 409 },
      );
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
