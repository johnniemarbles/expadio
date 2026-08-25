BEGIN;

CREATE TABLE platform.tenants (
  tenant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.organizations (
  organization_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  parent_organization_id uuid,
  organization_kind text NOT NULL DEFAULT 'BUSINESS',
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, tenant_id)
);

ALTER TABLE platform.organizations
  ADD CONSTRAINT organizations_parent_same_tenant_fk
  FOREIGN KEY (parent_organization_id, tenant_id)
  REFERENCES platform.organizations(organization_id, tenant_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE platform.workspaces (
  workspace_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, tenant_id),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE
);

CREATE TABLE platform.operating_units (
  operating_unit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  parent_operating_unit_id uuid,
  unit_kind text NOT NULL DEFAULT 'UNIT',
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operating_unit_id, tenant_id),
  UNIQUE (operating_unit_id, tenant_id, organization_id),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE
);

ALTER TABLE platform.operating_units
  ADD CONSTRAINT operating_units_parent_same_org_fk
  FOREIGN KEY (parent_operating_unit_id, tenant_id, organization_id)
  REFERENCES platform.operating_units(operating_unit_id, tenant_id, organization_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE platform.memberships (
  membership_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  subject_id text NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user','party','service','agent')),
  issuer text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
  workspace_scope_mode text NOT NULL DEFAULT 'ALL' CHECK (workspace_scope_mode IN ('ALL','SELECTED')),
  operating_unit_scope_mode text NOT NULL DEFAULT 'ALL' CHECK (operating_unit_scope_mode IN ('ALL','SELECTED')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, tenant_id),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT membership_validity_window CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE UNIQUE INDEX memberships_active_identity_org_uq
  ON platform.memberships (tenant_id, organization_id, subject_id, COALESCE(issuer, ''))
  WHERE status = 'ACTIVE';

CREATE TABLE platform.membership_workspaces (
  membership_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  PRIMARY KEY (membership_id, workspace_id),
  FOREIGN KEY (membership_id, tenant_id)
    REFERENCES platform.memberships(membership_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, tenant_id)
    REFERENCES platform.workspaces(workspace_id, tenant_id)
    ON DELETE CASCADE
);

CREATE TABLE platform.membership_operating_units (
  membership_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  operating_unit_id uuid NOT NULL,
  PRIMARY KEY (membership_id, operating_unit_id),
  FOREIGN KEY (membership_id, tenant_id)
    REFERENCES platform.memberships(membership_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (operating_unit_id, tenant_id)
    REFERENCES platform.operating_units(operating_unit_id, tenant_id)
    ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION platform.current_subject_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.subject_id', true), '')
$$;

CREATE OR REPLACE FUNCTION platform.current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
$$;

ALTER TABLE platform.connectors
  ADD CONSTRAINT connectors_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE;

ALTER TABLE platform.connector_routing_policies
  ADD CONSTRAINT routing_policies_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE;

ALTER TABLE platform.tenant_capability_bindings
  ADD CONSTRAINT capability_bindings_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE;

ALTER TABLE platform.tenant_capability_bindings
  ADD CONSTRAINT capability_bindings_org_same_tenant_fk
  FOREIGN KEY (organization_id, tenant_id)
  REFERENCES platform.organizations(organization_id, tenant_id)
  ON DELETE CASCADE;

CREATE INDEX organizations_tenant_idx ON platform.organizations(tenant_id);
CREATE INDEX workspaces_tenant_org_idx ON platform.workspaces(tenant_id, organization_id);
CREATE INDEX operating_units_tenant_org_idx ON platform.operating_units(tenant_id, organization_id);
CREATE INDEX memberships_subject_idx ON platform.memberships(subject_id, issuer, status);
CREATE INDEX memberships_tenant_org_idx ON platform.memberships(tenant_id, organization_id, status);

ALTER TABLE platform.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_isolation ON platform.tenants
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_tenant_isolation ON platform.organizations
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY workspaces_tenant_isolation ON platform.workspaces
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.operating_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.operating_units FORCE ROW LEVEL SECURITY;
CREATE POLICY operating_units_tenant_isolation ON platform.operating_units
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_tenant_isolation ON platform.memberships
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.membership_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.membership_workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_workspaces_tenant_isolation ON platform.membership_workspaces
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.membership_operating_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.membership_operating_units FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_operating_units_tenant_isolation ON platform.membership_operating_units
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
