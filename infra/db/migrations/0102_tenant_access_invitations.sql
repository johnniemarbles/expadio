BEGIN;

CREATE TABLE IF NOT EXISTS platform.tenant_access_invitations (
  invitation_id text PRIMARY KEY CHECK (btrim(invitation_id) <> ''),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  email_address text NOT NULL CHECK (btrim(email_address) <> ''),
  role_key text NOT NULL CHECK (btrim(role_key) <> ''),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ACCEPTED','REVOKED','EXPIRED')),
  invited_by_subject_id text NOT NULL CHECK (btrim(invited_by_subject_id) <> ''),
  accepted_subject_id text,
  valid_until timestamptz,
  clerk_created_at timestamptz,
  clerk_expires_at timestamptz,
  correlation_id text NOT NULL CHECK (btrim(correlation_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS tenant_access_invitations_workspace_idx
  ON platform.tenant_access_invitations
  (tenant_id, organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS tenant_access_invitations_email_idx
  ON platform.tenant_access_invitations
  (tenant_id, organization_id, lower(email_address), status);

ALTER TABLE platform.tenant_access_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_access_invitations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_access_invitations_tenant_all
  ON platform.tenant_access_invitations;
CREATE POLICY tenant_access_invitations_tenant_all
  ON platform.tenant_access_invitations
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
