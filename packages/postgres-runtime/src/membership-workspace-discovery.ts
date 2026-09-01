import type { IdentityContext } from '@expadio/tenancy';

export interface MembershipWorkspaceSqlResult<Row = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface MembershipWorkspaceSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<MembershipWorkspaceSqlResult<Row>>;
  release?(): void;
}

export interface MembershipWorkspaceSqlPool {
  connect(): Promise<MembershipWorkspaceSqlClient>;
}

export interface ActiveMembershipWorkspace {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly organizationId: string;
  readonly organizationName: string;
}

interface MembershipRow {
  readonly tenant_id: string;
  readonly organization_id: string;
}

interface WorkspaceRow {
  readonly tenant_id: string;
  readonly tenant_name: string;
  readonly organization_id: string;
  readonly organization_name: string;
}

/**
 * Resolve the workspaces visible to one already-verified identity.
 *
 * Membership bootstrap and tenant/organization label resolution deliberately
 * share one database transaction. The subject/issuer GUCs are transaction-local
 * and therefore remain present when forced-RLS policies evaluate the second
 * query. Splitting these operations across pooled/autocommit queries causes a
 * false "no membership" result even when the membership bootstrap succeeded.
 */
export async function listActiveMembershipWorkspaces(
  pool: MembershipWorkspaceSqlPool,
  identity: IdentityContext,
): Promise<readonly ActiveMembershipWorkspace[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.subject_id', $1, true),
              set_config('app.issuer', $2, true)`,
      [identity.subjectId, identity.issuer ?? ''],
    );

    const memberships = await client.query<MembershipRow>(
      `SELECT tenant_id, organization_id
         FROM platform.active_memberships_for_subject($1, $2)`,
      [identity.subjectId, identity.issuer ?? null],
    );

    if (memberships.rows.length === 0) {
      await client.query('COMMIT');
      return [];
    }

    const tenantIds = [...new Set(memberships.rows.map((row) => row.tenant_id))];
    const allowed = new Set(
      memberships.rows.map((row) => `${row.tenant_id}:${row.organization_id}`),
    );

    const labels = await client.query<WorkspaceRow>(
      `SELECT t.tenant_id,
              t.name AS tenant_name,
              o.organization_id,
              o.name AS organization_name
         FROM platform.tenants t
         JOIN platform.organizations o ON o.tenant_id = t.tenant_id
        WHERE t.tenant_id = ANY($1::uuid[])
          AND t.status = 'ACTIVE'
          AND o.status = 'ACTIVE'
        ORDER BY t.name, o.name`,
      [tenantIds],
    );

    await client.query('COMMIT');
    return labels.rows
      .filter((row) => allowed.has(`${row.tenant_id}:${row.organization_id}`))
      .map((row) => ({
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
      }));
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    client.release?.();
  }
}
