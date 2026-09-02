BEGIN;

CREATE TABLE IF NOT EXISTS platform.genesis_bootstrap_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id text NOT NULL CHECK (btrim(subject_id) <> ''),
  issuer text,
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_id, COALESCE(issuer, ''), idempotency_key),
  UNIQUE (tenant_id),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE
);

ALTER TABLE platform.genesis_bootstrap_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.genesis_bootstrap_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY genesis_bootstrap_requests_tenant_isolation
  ON platform.genesis_bootstrap_requests
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE OR REPLACE FUNCTION platform.bootstrap_genesis_tenant(
  p_subject_id text,
  p_issuer text,
  p_tenant_name text,
  p_organization_name text,
  p_idempotency_key text
)
RETURNS TABLE (
  tenant_id uuid,
  enterprise_id uuid,
  organization_id uuid,
  workspace_id uuid,
  membership_id uuid,
  assignment_id uuid,
  idempotent boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  existing platform.genesis_bootstrap_requests%ROWTYPE;
  new_tenant uuid;
  new_enterprise uuid;
  new_org uuid;
  new_workspace uuid;
  new_membership uuid;
  owner_role uuid;
  new_assignment uuid;
BEGIN
  IF NULLIF(btrim(p_subject_id), '') IS NULL
     OR NULLIF(btrim(p_tenant_name), '') IS NULL
     OR NULLIF(btrim(p_organization_name), '') IS NULL
     OR NULLIF(btrim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'genesis bootstrap fields are required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    coalesce(p_issuer, '') || '|' || p_subject_id, 0
  ));

  SELECT request.* INTO existing
    FROM platform.genesis_bootstrap_requests request
   WHERE request.subject_id = p_subject_id
     AND request.issuer IS NOT DISTINCT FROM p_issuer
     AND request.idempotency_key = p_idempotency_key
   LIMIT 1;

  IF FOUND THEN
    SELECT existing.tenant_id, org.enterprise_id, existing.organization_id,
           workspace.workspace_id, membership.membership_id, assignment.assignment_id,
           true
      INTO tenant_id, enterprise_id, organization_id, workspace_id,
           membership_id, assignment_id, idempotent
      FROM platform.organizations org
      JOIN platform.workspaces workspace
        ON workspace.organization_id = org.organization_id
       AND workspace.tenant_id = org.tenant_id
      JOIN platform.memberships membership
        ON membership.organization_id = org.organization_id
       AND membership.tenant_id = org.tenant_id
       AND membership.subject_id = p_subject_id
       AND membership.issuer IS NOT DISTINCT FROM p_issuer
      JOIN platform.authorization_assignments assignment
        ON assignment.organization_id = org.organization_id
       AND assignment.tenant_id = org.tenant_id
       AND assignment.subject_id = p_subject_id
      WHERE org.organization_id = existing.organization_id
        AND org.tenant_id = existing.tenant_id
      ORDER BY workspace.created_at, membership.created_at, assignment.created_at
      LIMIT 1;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO platform.tenants (name) VALUES (btrim(p_tenant_name))
    RETURNING platform.tenants.tenant_id INTO new_tenant;

  SELECT enterprise.enterprise_id INTO new_enterprise
    FROM platform.enterprise_profiles enterprise
   WHERE enterprise.tenant_id = new_tenant
   ORDER BY enterprise.created_at, enterprise.enterprise_id
   LIMIT 1;

  INSERT INTO platform.organizations (tenant_id, enterprise_id, name, organization_kind)
  VALUES (new_tenant, new_enterprise, btrim(p_organization_name), 'BUSINESS')
  RETURNING platform.organizations.organization_id INTO new_org;

  INSERT INTO platform.workspaces (tenant_id, organization_id, name)
  VALUES (new_tenant, new_org, btrim(p_organization_name))
  RETURNING platform.workspaces.workspace_id INTO new_workspace;

  INSERT INTO platform.memberships (
    tenant_id, organization_id, subject_id, actor_kind, issuer
  ) VALUES (new_tenant, new_org, p_subject_id, 'user', p_issuer)
  RETURNING platform.memberships.membership_id INTO new_membership;

  INSERT INTO platform.authorization_roles (
    role_key, display_name, ownership_scope, tenant_id
  ) VALUES ('TENANT_OWNER', 'Tenant owner', 'TENANT', new_tenant)
  RETURNING platform.authorization_roles.role_id INTO owner_role;

  INSERT INTO platform.authorization_assignments (
    tenant_id, organization_id, subject_id, role_id
  ) VALUES (new_tenant, new_org, p_subject_id, owner_role)
  RETURNING platform.authorization_assignments.assignment_id INTO new_assignment;

  INSERT INTO platform.genesis_bootstrap_requests (
    subject_id, issuer, idempotency_key, tenant_id, organization_id
  ) VALUES (p_subject_id, p_issuer, p_idempotency_key, new_tenant, new_org);

  RETURN QUERY SELECT new_tenant, new_enterprise, new_org, new_workspace,
                      new_membership, new_assignment, false;
END;
$$;

REVOKE ALL ON FUNCTION platform.bootstrap_genesis_tenant(text, text, text, text, text) FROM PUBLIC;

COMMENT ON FUNCTION platform.bootstrap_genesis_tenant(text, text, text, text, text) IS
  'Single-use genesis bootstrap: atomically creates tenant, enterprise root, organization, workspace, membership, and TENANT_OWNER authority.';

COMMIT;
