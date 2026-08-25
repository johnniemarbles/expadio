BEGIN;

CREATE TABLE platform.authorization_roles (
  role_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key text NOT NULL,
  display_name text NOT NULL,
  ownership_scope text NOT NULL CHECK (ownership_scope IN ('PLATFORM','TENANT')),
  tenant_id uuid REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT authorization_role_ownership CHECK (
    (ownership_scope = 'PLATFORM' AND tenant_id IS NULL)
    OR (ownership_scope = 'TENANT' AND tenant_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX authorization_roles_platform_key_uq
  ON platform.authorization_roles(role_key)
  WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX authorization_roles_tenant_key_uq
  ON platform.authorization_roles(tenant_id, role_key)
  WHERE tenant_id IS NOT NULL;

CREATE TABLE platform.authorization_role_capabilities (
  role_capability_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES platform.authorization_roles(role_id) ON DELETE CASCADE,
  action text NOT NULL,
  resource_type text NOT NULL,
  blocked_states text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, action, resource_type)
);

CREATE TABLE platform.authorization_assignments (
  assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid,
  subject_id text NOT NULL,
  role_id uuid NOT NULL REFERENCES platform.authorization_roles(role_id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
  action_organization_ids uuid[],
  action_operating_unit_ids uuid[],
  action_resource_ids text[],
  visibility_organization_ids uuid[],
  visibility_operating_unit_ids uuid[],
  visibility_resource_ids text[],
  clearances text[] NOT NULL DEFAULT ARRAY[]::text[],
  sensitive_compartments text[] NOT NULL DEFAULT ARRAY[]::text[],
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT authorization_assignment_validity CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT authorization_assignment_clearances CHECK (
    clearances <@ ARRAY['public','internal','confidential','restricted','sensitive']::text[]
  )
);

CREATE INDEX authorization_assignments_subject_idx
  ON platform.authorization_assignments(tenant_id, subject_id, status);

CREATE TABLE platform.authorization_restrictions (
  restriction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  subject_id text NOT NULL,
  restriction_key text NOT NULL,
  action text,
  resource_type text,
  resource_id text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT authorization_restriction_validity CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE INDEX authorization_restrictions_subject_idx
  ON platform.authorization_restrictions(tenant_id, subject_id, status);

CREATE OR REPLACE FUNCTION platform.validate_authorization_assignment_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  role_scope text;
  role_tenant uuid;
BEGIN
  SELECT ownership_scope, tenant_id INTO role_scope, role_tenant
  FROM platform.authorization_roles
  WHERE role_id = NEW.role_id AND status = 'ACTIVE';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'authorization role is missing or inactive';
  END IF;

  IF role_scope = 'TENANT' AND role_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'tenant-owned authorization role cannot cross tenants';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER authorization_assignment_role_scope
BEFORE INSERT OR UPDATE OF role_id, tenant_id ON platform.authorization_assignments
FOR EACH ROW EXECUTE FUNCTION platform.validate_authorization_assignment_role();

ALTER TABLE platform.authorization_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.authorization_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY authorization_roles_visibility ON platform.authorization_roles
  FOR SELECT USING (tenant_id IS NULL OR tenant_id = platform.current_tenant_id());

ALTER TABLE platform.authorization_role_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.authorization_role_capabilities FORCE ROW LEVEL SECURITY;
CREATE POLICY authorization_role_capabilities_visibility ON platform.authorization_role_capabilities
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM platform.authorization_roles r
      WHERE r.role_id = authorization_role_capabilities.role_id
    )
  );

ALTER TABLE platform.authorization_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.authorization_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY authorization_assignments_tenant_isolation ON platform.authorization_assignments
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.authorization_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.authorization_restrictions FORCE ROW LEVEL SECURITY;
CREATE POLICY authorization_restrictions_tenant_isolation ON platform.authorization_restrictions
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
