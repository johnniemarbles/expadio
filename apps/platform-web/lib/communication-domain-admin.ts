const COMMUNICATION_DOMAIN_ADMIN_ROLES = [
  'PLATFORM_SUPER_ADMIN',
  'PLATFORM_ADMIN',
  'TENANT_OWNER',
  'TENANT_ADMIN',
] as const;

export async function requireCommunicationDomainAdmin(
  client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }> },
  subjectId: string,
  tenantId: string,
): Promise<boolean> {
  const role = await client.query(
    `SELECT 1
       FROM platform.authorization_assignments assignment
       JOIN platform.authorization_roles role ON role.role_id = assignment.role_id
      WHERE assignment.subject_id = $1
        AND assignment.status = 'ACTIVE'
        AND role.status = 'ACTIVE'
        AND role.role_key = ANY($2::text[])
        AND assignment.valid_from <= now()
        AND (assignment.valid_until IS NULL OR assignment.valid_until > now())
        AND (
          role.ownership_scope = 'PLATFORM'
          OR (role.ownership_scope = 'TENANT' AND role.tenant_id = $3::uuid)
        )
      LIMIT 1`,
    [subjectId, COMMUNICATION_DOMAIN_ADMIN_ROLES, tenantId],
  );
  return role.rows.length > 0;
}
