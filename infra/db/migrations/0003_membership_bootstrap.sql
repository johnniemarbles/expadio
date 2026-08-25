BEGIN;

-- Membership bootstrap is the one deliberate pre-RLS lookup. It proves that
-- an authenticated subject belongs to tenant/organization scope before the
-- application binds app.tenant_id for normal RLS-protected work.
--
-- SECURITY DEFINER is intentionally narrow:
-- - fixed search_path
-- - read-only SQL function
-- - filters by authenticated subject + issuer
-- - returns only active/current membership scope
-- - PUBLIC execution revoked; deployment grants EXECUTE only to runtime role
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
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
  SELECT
    m.tenant_id,
    m.organization_id,
    m.workspace_scope_mode,
    CASE
      WHEN m.workspace_scope_mode = 'ALL' THEN NULL::uuid[]
      ELSE COALESCE(
        ARRAY(
          SELECT mw.workspace_id
          FROM platform.membership_workspaces mw
          WHERE mw.membership_id = m.membership_id
            AND mw.tenant_id = m.tenant_id
          ORDER BY mw.workspace_id
        ),
        ARRAY[]::uuid[]
      )
    END AS workspace_ids,
    m.operating_unit_scope_mode,
    CASE
      WHEN m.operating_unit_scope_mode = 'ALL' THEN NULL::uuid[]
      ELSE COALESCE(
        ARRAY(
          SELECT mou.operating_unit_id
          FROM platform.membership_operating_units mou
          WHERE mou.membership_id = m.membership_id
            AND mou.tenant_id = m.tenant_id
          ORDER BY mou.operating_unit_id
        ),
        ARRAY[]::uuid[]
      )
    END AS operating_unit_ids
  FROM platform.memberships m
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
    AND (
      (p_issuer IS NULL AND m.issuer IS NULL)
      OR m.issuer = p_issuer
    )
  ORDER BY m.tenant_id, m.organization_id;
$$;

REVOKE ALL ON FUNCTION platform.active_memberships_for_subject(text, text) FROM PUBLIC;

COMMENT ON FUNCTION platform.active_memberships_for_subject(text, text) IS
  'Pre-RLS membership bootstrap for a verified identity subject. Grant EXECUTE only to trusted runtime role.';

COMMIT;
