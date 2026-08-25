BEGIN;

CREATE TABLE platform.workflow_rights_profiles (
  rights_profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  profile_key text NOT NULL CHECK (btrim(profile_key) <> ''),
  version integer NOT NULL CHECK (version > 0),
  label text NOT NULL CHECK (btrim(label) <> ''),
  right_types text[] NOT NULL DEFAULT '{}',
  maximum_scope jsonb CHECK (maximum_scope IS NULL OR jsonb_typeof(maximum_scope) = 'object'),
  permits_exclusivity boolean NOT NULL DEFAULT false,
  permits_delegation boolean NOT NULL DEFAULT false,
  permits_sub_appointment boolean NOT NULL DEFAULT false,
  default_duration text,
  renewal_model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_subject_id text,
  CONSTRAINT workflow_rights_profiles_right_types_nonempty CHECK (cardinality(right_types) > 0)
);

CREATE UNIQUE INDEX workflow_rights_profiles_platform_identity_uq
  ON platform.workflow_rights_profiles (profile_key, version)
  WHERE tenant_id IS NULL;

CREATE UNIQUE INDEX workflow_rights_profiles_tenant_identity_uq
  ON platform.workflow_rights_profiles (tenant_id, profile_key, version)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX workflow_rights_profiles_platform_lookup_idx
  ON platform.workflow_rights_profiles (profile_key, version DESC)
  WHERE tenant_id IS NULL;

CREATE INDEX workflow_rights_profiles_tenant_lookup_idx
  ON platform.workflow_rights_profiles (tenant_id, profile_key, version DESC)
  WHERE tenant_id IS NOT NULL;

CREATE OR REPLACE FUNCTION platform.reject_workflow_rights_profile_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'workflow rights profile versions are immutable; create a new version instead';
END;
$$;

CREATE TRIGGER workflow_rights_profiles_immutable
BEFORE UPDATE OR DELETE ON platform.workflow_rights_profiles
FOR EACH ROW EXECUTE FUNCTION platform.reject_workflow_rights_profile_mutation();

ALTER TABLE platform.workflow_rights_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_rights_profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY workflow_rights_profiles_select
  ON platform.workflow_rights_profiles
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = platform.current_tenant_id()
  );

CREATE POLICY workflow_rights_profiles_tenant_insert
  ON platform.workflow_rights_profiles
  FOR INSERT
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = platform.current_tenant_id()
  );

COMMIT;
