import type { PoolClient } from 'pg';

/**
 * Governed writes require a governing role in the active tenant: a tenant
 * owner/admin (the workspace's own operators) or a platform admin. Reads only
 * require membership, which resolveRequestContext already establishes.
 *
 * This is the work-type-agnostic authorization primitive for the governed
 * engine — every vertical (case, vendor, expense, access request) and the
 * cross-vertical governance endpoints gate their writes through it. The
 * underlying decision runtime performs the finer per-decision checks (role +
 * separation of duties + any authority deriver); this is the top-level "may act
 * on governed work at all" gate. (`crm-authz` re-exports it as
 * `hasCrmWriteRole` for the CRM routes, which read more naturally that way.)
 */
const GOVERNANCE_WRITE_ROLES = ['TENANT_OWNER', 'TENANT_ADMIN', 'PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN'];

export async function hasGovernanceWriteRole(client: PoolClient, subjectId: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM platform.authorization_assignments a
       JOIN platform.authorization_roles r ON r.role_id = a.role_id
      WHERE a.subject_id = $1
        AND a.status = 'ACTIVE' AND r.status = 'ACTIVE'
        AND r.role_key = ANY($2::text[])
        AND (a.valid_until IS NULL OR a.valid_until > now())
      LIMIT 1`,
    [subjectId, GOVERNANCE_WRITE_ROLES],
  );
  return result.rows.length > 0;
}

// Highest authority first: platform roles outrank tenant roles.
const ROLE_RANK = ['PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN'];

/**
 * The highest-ranked governing role a subject holds in the active tenant, or
 * null if none. Used to record which role authorized a governed action.
 */
export async function resolveGoverningRole(client: PoolClient, subjectId: string): Promise<string | null> {
  const result = await client.query(
    `SELECT r.role_key
       FROM platform.authorization_assignments a
       JOIN platform.authorization_roles r ON r.role_id = a.role_id
      WHERE a.subject_id = $1
        AND a.status = 'ACTIVE' AND r.status = 'ACTIVE'
        AND r.role_key = ANY($2::text[])
        AND (a.valid_until IS NULL OR a.valid_until > now())`,
    [subjectId, GOVERNANCE_WRITE_ROLES],
  );
  const held = new Set(result.rows.map((row) => row.role_key as string));
  return ROLE_RANK.find((role) => held.has(role)) ?? null;
}


const PLATFORM_ADMINISTRATION_ROLES = ['PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN'];

/**
 * Commercial and platform-owned control-plane mutations require a role owned by
 * Platform itself. Tenant-owner/admin roles deliberately do not satisfy this
 * gate even though they can perform tenant-governed operational writes.
 */
export async function hasPlatformAdministrationRole(
  client: PoolClient,
  subjectId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM platform.authorization_assignments a
       JOIN platform.authorization_roles r ON r.role_id = a.role_id
      WHERE a.subject_id = $1
        AND a.status = 'ACTIVE'
        AND r.status = 'ACTIVE'
        AND r.ownership_scope = 'PLATFORM'
        AND r.role_key = ANY($2::text[])
        AND (a.valid_until IS NULL OR a.valid_until > now())
      LIMIT 1`,
    [subjectId, PLATFORM_ADMINISTRATION_ROLES],
  );
  return result.rows.length > 0;
}
