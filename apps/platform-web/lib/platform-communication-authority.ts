/** Server-side authority lookup. Request headers and role names supplied by
 * callers are never evidence of platform administration. */
export interface AuthorityClient {
  query(sql: string, values: unknown[]): Promise<{ rows: unknown[] }>;
}

export async function hasPlatformCommunicationAuthority(
  client: AuthorityClient,
  context: { subjectId: string; tenantId: string; organizationId: string | null },
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM platform.authorization_assignments a
       JOIN platform.authorization_roles r ON r.role_id = a.role_id
      WHERE a.subject_id = $1 AND a.tenant_id = $2::uuid
        AND a.status = 'ACTIVE' AND r.status = 'ACTIVE'
        AND r.ownership_scope = 'PLATFORM' AND r.tenant_id IS NULL
        AND r.role_key IN ('PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN')
        AND a.valid_from <= now()
        AND (a.valid_until IS NULL OR a.valid_until > now())
        AND (a.organization_id IS NULL OR a.organization_id = $3::uuid)
        AND a.action_organization_ids IS NULL
        AND a.action_operating_unit_ids IS NULL
        AND a.action_resource_ids IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM platform.authorization_restrictions restriction
           WHERE restriction.subject_id = a.subject_id
             AND restriction.tenant_id = a.tenant_id
             AND restriction.status = 'ACTIVE'
             AND restriction.valid_from <= now()
             AND (restriction.valid_until IS NULL OR restriction.valid_until > now())
        )
      LIMIT 1`,
    [context.subjectId, context.tenantId, context.organizationId || null],
  );
  return result.rows.length > 0;
}
