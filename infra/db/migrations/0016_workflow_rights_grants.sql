BEGIN;

CREATE TABLE platform.workflow_rights_grants (
  grant_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  instance_id uuid NOT NULL,
  work_type_key text NOT NULL CHECK (btrim(work_type_key) <> ''),
  beneficiary_subject_id text,
  beneficiary_organization_id uuid,
  profile_key text NOT NULL CHECK (btrim(profile_key) <> ''),
  profile_version integer NOT NULL CHECK (profile_version > 0),
  right_types text[] NOT NULL DEFAULT '{}',
  scope jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(scope) = 'object'),
  exclusivity_key text,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  source_decision_id text,
  source_agreement_id text,
  execution_verification_id text,
  granted_by_subject_id text NOT NULL CHECK (btrim(granted_by_subject_id) <> ''),
  granted_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('PENDING','ACTIVE','SUSPENDED','EXPIRED','REVOKED','TRANSFERRED')),
  evidence_refs text[] NOT NULL DEFAULT '{}',
  revoked_at timestamptz,
  revoked_by_subject_id text,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (instance_id, tenant_id)
    REFERENCES platform.workflow_instances(instance_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (beneficiary_organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT workflow_rights_grants_beneficiary_check CHECK (
    (beneficiary_subject_id IS NOT NULL)::integer
    + (beneficiary_organization_id IS NOT NULL)::integer = 1
  ),
  CONSTRAINT workflow_rights_grants_effective_range_check CHECK (
    effective_until IS NULL OR effective_until > effective_from
  ),
  CONSTRAINT workflow_rights_grants_revocation_shape_check CHECK (
    (state = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_by_subject_id IS NOT NULL)
    OR
    (state <> 'REVOKED' AND revoked_at IS NULL AND revoked_by_subject_id IS NULL AND revocation_reason IS NULL)
  ),
  UNIQUE (grant_id, tenant_id)
);

CREATE INDEX workflow_rights_grants_tenant_instance_idx
  ON platform.workflow_rights_grants (tenant_id, instance_id, granted_at DESC);

CREATE INDEX workflow_rights_grants_tenant_beneficiary_org_idx
  ON platform.workflow_rights_grants (tenant_id, beneficiary_organization_id, state)
  WHERE beneficiary_organization_id IS NOT NULL;

CREATE INDEX workflow_rights_grants_tenant_beneficiary_subject_idx
  ON platform.workflow_rights_grants (tenant_id, beneficiary_subject_id, state)
  WHERE beneficiary_subject_id IS NOT NULL;

CREATE OR REPLACE FUNCTION platform.reject_workflow_rights_grant_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'workflow rights grants are immutable; lifecycle changes require explicit events';
END;
$$;

CREATE TRIGGER workflow_rights_grants_immutable
BEFORE UPDATE OR DELETE ON platform.workflow_rights_grants
FOR EACH ROW EXECUTE FUNCTION platform.reject_workflow_rights_grant_mutation();

ALTER TABLE platform.workflow_rights_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_rights_grants FORCE ROW LEVEL SECURITY;

CREATE POLICY workflow_rights_grants_select
  ON platform.workflow_rights_grants
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY workflow_rights_grants_insert
  ON platform.workflow_rights_grants
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
