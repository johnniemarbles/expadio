import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { appendDomainEventWithOutbox } from '@expadio/postgres-runtime/domain-events';

export const TENANT_ACCESS_ROLE_KEYS = [
  'TENANT_OWNER',
  'TENANT_ADMIN',
  'TENANT_OPERATOR',
  'TENANT_FINANCE',
  'TENANT_COMPLIANCE',
] as const;

export type TenantAccessRoleKey = (typeof TENANT_ACCESS_ROLE_KEYS)[number];

export interface TenantMembershipRecord {
  readonly membershipId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly subjectId: string;
  readonly issuer: string | null;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  readonly validFrom: string;
  readonly validUntil: string | null;
  readonly roleKeys: readonly string[];
}

interface MembershipRow {
  membership_id: string;
  tenant_id: string;
  organization_id: string;
  subject_id: string;
  issuer: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  valid_from: Date | string;
  valid_until: Date | string | null;
  role_keys: string[];
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
function record(row: MembershipRow): TenantMembershipRecord {
  return {
    membershipId: row.membership_id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    subjectId: row.subject_id,
    issuer: row.issuer,
    status: row.status,
    validFrom: iso(row.valid_from),
    validUntil: row.valid_until === null ? null : iso(row.valid_until),
    roleKeys: row.role_keys ?? [],
  };
}

export async function listTenantMemberships(
  client: PoolClient,
  input: { tenantId: string; organizationId: string },
): Promise<readonly TenantMembershipRecord[]> {
  const result = await client.query<MembershipRow>(
    `SELECT m.membership_id, m.tenant_id, m.organization_id, m.subject_id,
            m.issuer, m.status, m.valid_from, m.valid_until,
            COALESCE(ARRAY(
              SELECT DISTINCT r.role_key
                FROM platform.authorization_assignments a
                JOIN platform.authorization_roles r ON r.role_id = a.role_id
               WHERE a.tenant_id = m.tenant_id
                 AND a.organization_id = m.organization_id
                 AND a.subject_id = m.subject_id
                 AND a.status = CASE m.status
                   WHEN 'ACTIVE' THEN 'ACTIVE'
                   WHEN 'SUSPENDED' THEN 'SUSPENDED'
                   ELSE 'REVOKED'
                 END
                 AND r.status = 'ACTIVE'
                 AND r.ownership_scope = 'TENANT'
               ORDER BY r.role_key
            ), ARRAY[]::text[]) AS role_keys
       FROM platform.memberships m
      WHERE m.tenant_id = $1::uuid
        AND m.organization_id = $2::uuid
      ORDER BY m.created_at DESC`,
    [input.tenantId, input.organizationId],
  );
  return result.rows.map(record);
}

async function appendAccessEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    aggregateId: string;
    eventType: string;
    actorSubjectId: string;
    correlationId: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await appendDomainEventWithOutbox(client, {
    event: {
      eventId: randomUUID(),
      tenantId: input.tenantId,
      aggregateType: 'tenant.access',
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      eventVersion: 1,
      occurredAt: new Date(),
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: input.payload,
      metadata: { source: 'platform.tenant-access' },
    },
  });
}

async function roleId(
  client: PoolClient,
  tenantId: string,
  roleKey: TenantAccessRoleKey,
): Promise<string> {
  const result = await client.query<{ role_id: string }>(
    `SELECT role_id
       FROM platform.authorization_roles
      WHERE tenant_id = $1::uuid
        AND ownership_scope = 'TENANT'
        AND role_key = $2
        AND status = 'ACTIVE'
      LIMIT 1`,
    [tenantId, roleKey],
  );
  const row = result.rows[0];
  if (!row) throw new Error('TENANT_ACCESS_ROLE_NOT_CONFIGURED');
  return row.role_id;
}

export async function grantTenantMembership(
  client: PoolClient,
  input: {
    tenantId: string;
    organizationId: string;
    subjectId: string;
    issuer: string;
    roleKey: TenantAccessRoleKey;
    validUntil?: Date | null;
    actorSubjectId: string;
    correlationId: string;
  },
): Promise<TenantMembershipRecord> {
  if (input.validUntil && input.validUntil.getTime() <= Date.now()) {
    throw new Error('TENANT_ACCESS_WINDOW_INVALID');
  }
  const org = await client.query(
    `SELECT 1 FROM platform.organizations
      WHERE tenant_id = $1::uuid AND organization_id = $2::uuid AND status = 'ACTIVE'`,
    [input.tenantId, input.organizationId],
  );
  if (!org.rows[0]) throw new Error('TENANT_ACCESS_ORGANIZATION_INVALID');

  const existing = await client.query<MembershipRow>(
    `SELECT m.membership_id, m.tenant_id, m.organization_id, m.subject_id,
            m.issuer, m.status, m.valid_from, m.valid_until,
            ARRAY[]::text[] AS role_keys
       FROM platform.memberships m
      WHERE m.tenant_id = $1::uuid
        AND m.organization_id = $2::uuid
        AND m.subject_id = $3
        AND m.issuer IS NOT DISTINCT FROM $4
      ORDER BY (m.status = 'ACTIVE') DESC, m.updated_at DESC
      LIMIT 1
      FOR UPDATE`,
    [input.tenantId, input.organizationId, input.subjectId, input.issuer],
  );
  let membershipId: string;
  const current = existing.rows[0];
  if (current?.status === 'REVOKED') {
    const inserted = await client.query<{ membership_id: string }>(
      `INSERT INTO platform.memberships
        (tenant_id, organization_id, subject_id, actor_kind, issuer, status,
         workspace_scope_mode, operating_unit_scope_mode, valid_until)
       VALUES ($1::uuid, $2::uuid, $3, 'user', $4, 'ACTIVE', 'ALL', 'ALL', $5)
       RETURNING membership_id`,
      [input.tenantId, input.organizationId, input.subjectId, input.issuer, input.validUntil ?? null],
    );
    membershipId = inserted.rows[0]!.membership_id;
  } else if (current) {
    const updated = await client.query<{ membership_id: string }>(
      `UPDATE platform.memberships
          SET status = 'ACTIVE', valid_until = $5, updated_at = now()
        WHERE membership_id = $1::uuid
          AND tenant_id = $2::uuid
          AND organization_id = $3::uuid
          AND subject_id = $4
        RETURNING membership_id`,
      [current.membership_id, input.tenantId, input.organizationId, input.subjectId, input.validUntil ?? null],
    );
    membershipId = updated.rows[0]!.membership_id;
  } else {
    const inserted = await client.query<{ membership_id: string }>(
      `INSERT INTO platform.memberships
        (tenant_id, organization_id, subject_id, actor_kind, issuer, status,
         workspace_scope_mode, operating_unit_scope_mode, valid_until)
       VALUES ($1::uuid, $2::uuid, $3, 'user', $4, 'ACTIVE', 'ALL', 'ALL', $5)
       RETURNING membership_id`,
      [input.tenantId, input.organizationId, input.subjectId, input.issuer, input.validUntil ?? null],
    );
    membershipId = inserted.rows[0]!.membership_id;
  }

  await replaceTenantMembershipRoles(client, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    subjectId: input.subjectId,
    roleKeys: [input.roleKey],
    actorSubjectId: input.actorSubjectId,
    correlationId: input.correlationId,
    emitEvent: false,
  });

  await appendAccessEvent(client, {
    tenantId: input.tenantId,
    aggregateId: membershipId,
    eventType: 'tenant.membership.granted',
    actorSubjectId: input.actorSubjectId,
    correlationId: input.correlationId,
    payload: {
      organizationId: input.organizationId,
      subjectId: input.subjectId,
      roleKeys: [input.roleKey],
      validUntil: input.validUntil?.toISOString() ?? null,
    },
  });

  const records = await listTenantMemberships(client, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  });
  const result = records.find((item) => item.membershipId === membershipId);
  if (!result) throw new Error('TENANT_ACCESS_WRITE_FAILED');
  return result;
}

export async function replaceTenantMembershipRoles(
  client: PoolClient,
  input: {
    tenantId: string;
    organizationId: string;
    subjectId: string;
    roleKeys: readonly TenantAccessRoleKey[];
    actorSubjectId: string;
    correlationId: string;
    emitEvent?: boolean;
  },
): Promise<void> {
  const unique = [...new Set(input.roleKeys)];
  if (unique.length === 0) throw new Error('TENANT_ACCESS_ROLE_REQUIRED');

  const ids = new Map<string,string>();
  for (const key of unique) ids.set(key, await roleId(client, input.tenantId, key));

  await client.query(
    `UPDATE platform.authorization_assignments a
        SET status = 'REVOKED', updated_at = now()
       FROM platform.authorization_roles r
      WHERE a.role_id = r.role_id
        AND a.tenant_id = $1::uuid
        AND a.organization_id = $2::uuid
        AND a.subject_id = $3
        AND a.status = 'ACTIVE'
        AND r.ownership_scope = 'TENANT'
        AND NOT (r.role_key = ANY($4::text[]))`,
    [input.tenantId, input.organizationId, input.subjectId, unique],
  );

  for (const roleKey of unique) {
    const id = ids.get(roleKey)!;
    const existing = await client.query<{ assignment_id: string; status: string }>(
      `SELECT assignment_id, status
         FROM platform.authorization_assignments
        WHERE tenant_id = $1::uuid
          AND organization_id = $2::uuid
          AND subject_id = $3
          AND role_id = $4::uuid
        ORDER BY updated_at DESC
        LIMIT 1
        FOR UPDATE`,
      [input.tenantId, input.organizationId, input.subjectId, id],
    );
    if (existing.rows[0]) {
      await client.query(
        `UPDATE platform.authorization_assignments
            SET status = 'ACTIVE', valid_until = NULL, updated_at = now()
          WHERE assignment_id = $1::uuid`,
        [existing.rows[0].assignment_id],
      );
    } else {
      await client.query(
        `INSERT INTO platform.authorization_assignments
          (tenant_id, organization_id, subject_id, role_id, status)
         VALUES ($1::uuid, $2::uuid, $3, $4::uuid, 'ACTIVE')`,
        [input.tenantId, input.organizationId, input.subjectId, id],
      );
    }
  }

  if (input.emitEvent !== false) {
    await appendAccessEvent(client, {
      tenantId: input.tenantId,
      aggregateId: input.subjectId,
      eventType: 'tenant.membership.roles.updated',
      actorSubjectId: input.actorSubjectId,
      correlationId: input.correlationId,
      payload: { organizationId: input.organizationId, roleKeys: unique },
    });
  }
}

export async function setTenantMembershipStatus(
  client: PoolClient,
  input: {
    tenantId: string;
    organizationId: string;
    membershipId: string;
    status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
    actorSubjectId: string;
    correlationId: string;
  },
): Promise<TenantMembershipRecord> {
  const current = await client.query<{ subject_id: string; status: string }>(
    `SELECT subject_id, status
       FROM platform.memberships
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
        AND membership_id = $3::uuid
      FOR UPDATE`,
    [input.tenantId, input.organizationId, input.membershipId],
  );
  const row = current.rows[0];
  if (!row) throw new Error('TENANT_MEMBERSHIP_NOT_FOUND');
  if (row.status === 'REVOKED' && input.status === 'ACTIVE') {
    throw new Error('TENANT_MEMBERSHIP_REVOKED_REQUIRES_NEW_GRANT');
  }

  if (row.status === input.status) {
    const records = await listTenantMemberships(client, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    });
    const unchanged = records.find((item) => item.membershipId === input.membershipId);
    if (!unchanged) throw new Error('TENANT_ACCESS_WRITE_FAILED');
    return unchanged;
  }

  await client.query(
    `UPDATE platform.memberships
        SET status = $4, updated_at = now()
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
        AND membership_id = $3::uuid`,
    [input.tenantId, input.organizationId, input.membershipId, input.status],
  );

  if (input.status === 'SUSPENDED') {
    await client.query(
      `UPDATE platform.authorization_assignments a
          SET status = 'SUSPENDED', updated_at = now()
         FROM platform.authorization_roles r
        WHERE a.role_id = r.role_id
          AND a.tenant_id = $1::uuid
          AND a.organization_id = $2::uuid
          AND a.subject_id = $3
          AND a.status = 'ACTIVE'
          AND r.ownership_scope = 'TENANT'
          AND r.tenant_id = $1::uuid`,
      [input.tenantId, input.organizationId, row.subject_id],
    );
  } else if (input.status === 'REVOKED') {
    await client.query(
      `UPDATE platform.authorization_assignments a
          SET status = 'REVOKED', updated_at = now()
         FROM platform.authorization_roles r
        WHERE a.role_id = r.role_id
          AND a.tenant_id = $1::uuid
          AND a.organization_id = $2::uuid
          AND a.subject_id = $3
          AND a.status IN ('ACTIVE','SUSPENDED')
          AND r.ownership_scope = 'TENANT'
          AND r.tenant_id = $1::uuid`,
      [input.tenantId, input.organizationId, row.subject_id],
    );
  } else {
    await client.query(
      `UPDATE platform.authorization_assignments a
          SET status = 'ACTIVE', updated_at = now()
         FROM platform.authorization_roles r
        WHERE a.role_id = r.role_id
          AND a.tenant_id = $1::uuid
          AND a.organization_id = $2::uuid
          AND a.subject_id = $3
          AND a.status = 'SUSPENDED'
          AND r.ownership_scope = 'TENANT'
          AND r.tenant_id = $1::uuid`,
      [input.tenantId, input.organizationId, row.subject_id],
    );
  }

  await appendAccessEvent(client, {
    tenantId: input.tenantId,
    aggregateId: input.membershipId,
    eventType: `tenant.membership.${input.status.toLowerCase()}`,
    actorSubjectId: input.actorSubjectId,
    correlationId: input.correlationId,
    payload: { organizationId: input.organizationId, subjectId: row.subject_id },
  });

  const records = await listTenantMemberships(client, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  });
  const result = records.find((item) => item.membershipId === input.membershipId);
  if (!result) throw new Error('TENANT_ACCESS_WRITE_FAILED');
  return result;
}

export async function recordTenantInvitation(
  client: PoolClient,
  input: {
    tenantId: string;
    organizationId: string;
    invitationId: string;
    roleKey: TenantAccessRoleKey;
    actorSubjectId: string;
    correlationId: string;
    eventType?: 'tenant.membership.invited' | 'tenant.membership.invitation.revoked';
  },
): Promise<void> {
  await appendAccessEvent(client, {
    tenantId: input.tenantId,
    aggregateId: input.invitationId,
    eventType: input.eventType ?? 'tenant.membership.invited',
    actorSubjectId: input.actorSubjectId,
    correlationId: input.correlationId,
    payload: { organizationId: input.organizationId, roleKeys: [input.roleKey] },
  });
}


export interface TenantAccessInvitationRecord {
  readonly invitationId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly email: string;
  readonly roleKey: string;
  readonly status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  readonly invitedBySubjectId: string;
  readonly acceptedSubjectId: string | null;
  readonly validUntil: string | null;
  readonly clerkCreatedAt: string | null;
  readonly clerkExpiresAt: string | null;
  readonly correlationId: string;
  readonly createdAt: string;
}

interface InvitationRow {
  invitation_id: string;
  tenant_id: string;
  organization_id: string;
  email_address: string;
  role_key: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  invited_by_subject_id: string;
  accepted_subject_id: string | null;
  valid_until: Date | string | null;
  clerk_created_at: Date | string | null;
  clerk_expires_at: Date | string | null;
  correlation_id: string;
  created_at: Date | string;
}

function invitationRecord(row: InvitationRow): TenantAccessInvitationRecord {
  return {
    invitationId: row.invitation_id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    email: row.email_address,
    roleKey: row.role_key,
    status: row.status,
    invitedBySubjectId: row.invited_by_subject_id,
    acceptedSubjectId: row.accepted_subject_id,
    validUntil: row.valid_until === null ? null : iso(row.valid_until),
    clerkCreatedAt: row.clerk_created_at === null ? null : iso(row.clerk_created_at),
    clerkExpiresAt: row.clerk_expires_at === null ? null : iso(row.clerk_expires_at),
    correlationId: row.correlation_id,
    createdAt: iso(row.created_at),
  };
}

export async function upsertTenantAccessInvitation(
  client: PoolClient,
  input: {
    tenantId: string;
    organizationId: string;
    invitationId: string;
    email: string;
    roleKey: TenantAccessRoleKey;
    invitedBySubjectId: string;
    correlationId: string;
    validUntil?: Date | null;
    clerkCreatedAt?: Date | null;
    clerkExpiresAt?: Date | null;
  },
): Promise<TenantAccessInvitationRecord> {
  const result = await client.query<InvitationRow>(
    `INSERT INTO platform.tenant_access_invitations (
       invitation_id, tenant_id, organization_id, email_address, role_key,
       status, invited_by_subject_id, valid_until, clerk_created_at,
       clerk_expires_at, correlation_id
     ) VALUES (
       $1, $2::uuid, $3::uuid, lower($4), $5, 'PENDING', $6,
       $7::timestamptz, $8::timestamptz, $9::timestamptz, $10
     )
     ON CONFLICT (invitation_id) DO UPDATE
       SET email_address = EXCLUDED.email_address,
           role_key = EXCLUDED.role_key,
           invited_by_subject_id = EXCLUDED.invited_by_subject_id,
           valid_until = EXCLUDED.valid_until,
           clerk_created_at = COALESCE(EXCLUDED.clerk_created_at, platform.tenant_access_invitations.clerk_created_at),
           clerk_expires_at = COALESCE(EXCLUDED.clerk_expires_at, platform.tenant_access_invitations.clerk_expires_at),
           correlation_id = EXCLUDED.correlation_id,
           updated_at = clock_timestamp()
     RETURNING *`,
    [
      input.invitationId,
      input.tenantId,
      input.organizationId,
      input.email.trim().toLowerCase(),
      input.roleKey,
      input.invitedBySubjectId,
      input.validUntil ?? null,
      input.clerkCreatedAt ?? null,
      input.clerkExpiresAt ?? null,
      input.correlationId,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('TENANT_INVITATION_WRITE_FAILED');
  return invitationRecord(row);
}

export async function listPendingTenantAccessInvitations(
  client: PoolClient,
  input: { tenantId: string; organizationId: string },
): Promise<readonly TenantAccessInvitationRecord[]> {
  const result = await client.query<InvitationRow>(
    `SELECT *
       FROM platform.tenant_access_invitations
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
        AND status = 'PENDING'
      ORDER BY created_at DESC`,
    [input.tenantId, input.organizationId],
  );
  return result.rows.map(invitationRecord);
}

export async function findTenantAccessInvitation(
  client: PoolClient,
  input: { tenantId: string; organizationId: string; invitationId: string },
): Promise<TenantAccessInvitationRecord | null> {
  const result = await client.query<InvitationRow>(
    `SELECT *
       FROM platform.tenant_access_invitations
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
        AND invitation_id = $3
      LIMIT 1`,
    [input.tenantId, input.organizationId, input.invitationId],
  );
  return result.rows[0] ? invitationRecord(result.rows[0]) : null;
}

export async function setTenantAccessInvitationStatus(
  client: PoolClient,
  input: {
    tenantId: string;
    organizationId: string;
    invitationId: string;
    status: 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
    acceptedSubjectId?: string | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE platform.tenant_access_invitations
        SET status = $4,
            accepted_subject_id = COALESCE($5, accepted_subject_id),
            updated_at = clock_timestamp()
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
        AND invitation_id = $3`,
    [
      input.tenantId,
      input.organizationId,
      input.invitationId,
      input.status,
      input.acceptedSubjectId ?? null,
    ],
  );
}

export async function acceptPendingTenantInvitationByEmail(
  client: PoolClient,
  input: {
    tenantId: string;
    organizationId: string;
    email: string;
    acceptedSubjectId: string;
  },
): Promise<void> {
  await client.query(
    `UPDATE platform.tenant_access_invitations
        SET status = 'ACCEPTED',
            accepted_subject_id = $4,
            updated_at = clock_timestamp()
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
        AND lower(email_address) = lower($3)
        AND status = 'PENDING'`,
    [input.tenantId, input.organizationId, input.email, input.acceptedSubjectId],
  );
}
