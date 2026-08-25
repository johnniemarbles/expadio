BEGIN;

CREATE OR REPLACE FUNCTION platform.current_issuer()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.issuer', true), '')
$$;

-- Bootstrap SELECT policies are deliberately subject-scoped rather than
-- tenant-scoped. They allow a verified identity to discover only its own
-- membership graph before app.tenant_id has been trusted/bound.
CREATE POLICY memberships_subject_bootstrap_select ON platform.memberships
  FOR SELECT
  USING (
    subject_id = platform.current_subject_id()
    AND issuer IS NOT DISTINCT FROM platform.current_issuer()
  );

CREATE POLICY tenants_subject_bootstrap_select ON platform.tenants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM platform.memberships m
      WHERE m.tenant_id = tenants.tenant_id
        AND m.subject_id = platform.current_subject_id()
        AND m.issuer IS NOT DISTINCT FROM platform.current_issuer()
        AND m.status = 'ACTIVE'
        AND m.valid_from <= now()
        AND (m.valid_until IS NULL OR m.valid_until > now())
    )
  );

CREATE POLICY organizations_subject_bootstrap_select ON platform.organizations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM platform.memberships m
      WHERE m.tenant_id = organizations.tenant_id
        AND m.organization_id = organizations.organization_id
        AND m.subject_id = platform.current_subject_id()
        AND m.issuer IS NOT DISTINCT FROM platform.current_issuer()
        AND m.status = 'ACTIVE'
        AND m.valid_from <= now()
        AND (m.valid_until IS NULL OR m.valid_until > now())
    )
  );

CREATE POLICY membership_workspaces_subject_bootstrap_select ON platform.membership_workspaces
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM platform.memberships m
      WHERE m.membership_id = membership_workspaces.membership_id
        AND m.tenant_id = membership_workspaces.tenant_id
        AND m.subject_id = platform.current_subject_id()
        AND m.issuer IS NOT DISTINCT FROM platform.current_issuer()
        AND m.status = 'ACTIVE'
        AND m.valid_from <= now()
        AND (m.valid_until IS NULL OR m.valid_until > now())
    )
  );

CREATE POLICY membership_operating_units_subject_bootstrap_select ON platform.membership_operating_units
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM platform.memberships m
      WHERE m.membership_id = membership_operating_units.membership_id
        AND m.tenant_id = membership_operating_units.tenant_id
        AND m.subject_id = platform.current_subject_id()
        AND m.issuer IS NOT DISTINCT FROM platform.current_issuer()
        AND m.status = 'ACTIVE'
        AND m.valid_from <= now()
        AND (m.valid_until IS NULL OR m.valid_until > now())
    )
  );

-- Membership bootstrap is the one deliberate pre-tenant lookup. It does not
-- rely on table-owner/BYPASSRLS behavior: the function sets only verified
-- subject/issuer context and still reads through the forced-RLS policies above.
-- PUBLIC execution is revoked; deployment grants EXECUTE only to the trusted
-- runtime DB role used after application-layer authentication.
CREATE OR REPLACE FUNCTION platform.active_memberships_for_subject(
  p_subject_id text,
  p_issuer text DEFAULT NULL
)
RETURNS TABLE (
  tenant_id uuid,
  organization_id uuid,
  workspace_scope_mode text,
  workspace_ids uuid[],
  operating_unit_scope_mode text,
  operating_unit_ids uuid[]
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
  WITH bootstrap_context AS MATERIALIZED (
    SELECT
      set_config('app.subject_id', p_subject_id, true) AS subject_setting,
      set_config('app.issuer', COALESCE(p_issuer, ''), true) AS issuer_setting
  )
  SELECT
    m.tenant_id,
    m.organization_id,
    m.workspace_scope_mode,
    CASE
      WHEN m.workspace_scope_mode = 'ALL' THEN NULL::uuid[]
      ELSE ARRAY(
        SELECT mw.workspace_id
        FROM platform.membership_workspaces mw
        WHERE mw.membership_id = m.membership_id
          AND mw.tenant_id = m.tenant_id
        ORDER BY mw.workspace_id
      )
    END AS workspace_ids,
    m.operating_unit_scope_mode,
    CASE
      WHEN m.operating_unit_scope_mode = 'ALL' THEN NULL::uuid[]
      ELSE ARRAY(
        SELECT mou.operating_unit_id
        FROM platform.membership_operating_units mou
        WHERE mou.membership_id = m.membership_id
          AND mou.tenant_id = m.tenant_id
        ORDER BY mou.operating_unit_id
      )
    END AS operating_unit_ids
  FROM bootstrap_context
  CROSS JOIN platform.memberships m
  JOIN platform.tenants t
    ON t.tenant_id = m.tenant_id
   AND t.status = 'ACTIVE'
  JOIN platform.organizations o
    ON o.organization_id = m.organization_id
   AND o.tenant_id = m.tenant_id
   AND o.status = 'ACTIVE'
  WHERE m.subject_id = p_subject_id
    AND m.status = 'ACTIVE'
    AND m.valid_from <= now()
    AND (m.valid_until IS NULL OR m.valid_until > now())
    AND m.issuer IS NOT DISTINCT FROM p_issuer
  ORDER BY m.tenant_id, m.organization_id;
$$;

REVOKE ALL ON FUNCTION platform.active_memberships_for_subject(text, text) FROM PUBLIC;

COMMENT ON FUNCTION platform.active_memberships_for_subject(text, text) IS
  'Pre-tenant membership bootstrap for a verified identity subject; remains constrained by subject-scoped forced RLS.';

COMMIT;
