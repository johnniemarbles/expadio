BEGIN;

CREATE TABLE platform.workflow_activation_blueprints (
  activation_blueprint_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  blueprint_key text NOT NULL CHECK (btrim(blueprint_key) <> ''),
  version integer NOT NULL CHECK (version > 0),
  label text NOT NULL CHECK (btrim(label) <> ''),
  work_type_key text NOT NULL CHECK (btrim(work_type_key) <> ''),
  provisioning_model text NOT NULL CHECK (
    provisioning_model IN (
      'FULL_WORKSPACE',
      'SCOPED_WORKSPACE',
      'RESTRICTED_PORTAL',
      'ACCOUNT_ONLY',
      'NO_PROVISIONING'
    )
  ),
  steps jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_subject_id text,
  CONSTRAINT workflow_activation_blueprints_creator_check CHECK (
    created_by_subject_id IS NULL OR btrim(created_by_subject_id) <> ''
  )
);

CREATE UNIQUE INDEX workflow_activation_blueprints_platform_identity_uq
  ON platform.workflow_activation_blueprints (blueprint_key, version)
  WHERE tenant_id IS NULL;

CREATE UNIQUE INDEX workflow_activation_blueprints_tenant_identity_uq
  ON platform.workflow_activation_blueprints (tenant_id, blueprint_key, version)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX workflow_activation_blueprints_platform_lookup_idx
  ON platform.workflow_activation_blueprints (blueprint_key, version DESC)
  WHERE tenant_id IS NULL;

CREATE INDEX workflow_activation_blueprints_tenant_lookup_idx
  ON platform.workflow_activation_blueprints (tenant_id, blueprint_key, version DESC)
  WHERE tenant_id IS NOT NULL;

CREATE OR REPLACE FUNCTION platform.reject_workflow_activation_blueprint_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'workflow activation blueprint versions are immutable; create a new version instead';
END;
$$;

CREATE TRIGGER workflow_activation_blueprints_immutable
BEFORE UPDATE OR DELETE ON platform.workflow_activation_blueprints
FOR EACH ROW EXECUTE FUNCTION platform.reject_workflow_activation_blueprint_mutation();

ALTER TABLE platform.workflow_activation_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_activation_blueprints FORCE ROW LEVEL SECURITY;

CREATE POLICY workflow_activation_blueprints_select
  ON platform.workflow_activation_blueprints
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = platform.current_tenant_id()
  );

CREATE POLICY workflow_activation_blueprints_tenant_insert
  ON platform.workflow_activation_blueprints
  FOR INSERT
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = platform.current_tenant_id()
  );

COMMIT;
