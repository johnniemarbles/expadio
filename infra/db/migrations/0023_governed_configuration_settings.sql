BEGIN;

CREATE TABLE platform.configuration_setting_definitions (
  definition_id uuid PRIMARY KEY,
  setting_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  value_schema jsonb NOT NULL CHECK (jsonb_typeof(value_schema) = 'object'),
  classification text NOT NULL CHECK (
    classification IN ('PUBLIC', 'INTERNAL', 'SENSITIVE')
  ),
  override_mode text NOT NULL CHECK (
    override_mode IN ('LOCKED', 'BOUNDED', 'OVERRIDABLE')
  ),
  allowed_override_levels text[] NOT NULL CHECK (
    array_position(allowed_override_levels, NULL) IS NULL
  ),
  authored_by_subject_id text NOT NULL CHECK (btrim(authored_by_subject_id) <> ''),
  authored_at timestamptz NOT NULL,
  effective_from timestamptz NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  evidence_refs text[] NOT NULL CHECK (
    cardinality(evidence_refs) > 0
    AND array_position(evidence_refs, NULL) IS NULL
  ),
  UNIQUE (setting_key, version)
);

CREATE TABLE platform.configuration_setting_values (
  value_id uuid PRIMARY KEY,
  setting_key text NOT NULL,
  definition_version integer NOT NULL,
  level text NOT NULL CHECK (level IN (
    'SYSTEM_INVARIANT', 'PLATFORM', 'ENVIRONMENT', 'PLAN', 'VERTICAL',
    'TENANT', 'BRAND', 'WORKSPACE', 'USER_PREFERENCE', 'OPERATIONAL'
  )),
  scope_id text,
  tenant_id uuid REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  record_version integer NOT NULL CHECK (record_version > 0),
  value jsonb NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  authored_by_subject_id text NOT NULL CHECK (btrim(authored_by_subject_id) <> ''),
  authored_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  correlation_id uuid NOT NULL,
  evidence_refs text[] NOT NULL CHECK (
    cardinality(evidence_refs) > 0
    AND array_position(evidence_refs, NULL) IS NULL
  ),
  FOREIGN KEY (setting_key, definition_version)
    REFERENCES platform.configuration_setting_definitions(setting_key, version),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  CHECK (
    (level IN ('SYSTEM_INVARIANT', 'PLATFORM')
      AND scope_id IS NULL AND tenant_id IS NULL)
    OR (level IN ('ENVIRONMENT', 'PLAN', 'VERTICAL')
      AND btrim(scope_id) <> '' AND tenant_id IS NULL)
    OR (level = 'TENANT'
      AND scope_id = tenant_id::text AND tenant_id IS NOT NULL)
    OR (level IN ('BRAND', 'WORKSPACE', 'USER_PREFERENCE', 'OPERATIONAL')
      AND btrim(scope_id) <> '' AND tenant_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX configuration_setting_values_version_idx
  ON platform.configuration_setting_values
    (setting_key, level, COALESCE(scope_id, ''), record_version);

CREATE INDEX configuration_setting_values_resolution_idx
  ON platform.configuration_setting_values
    (setting_key, level, COALESCE(scope_id, ''), effective_from DESC, record_version DESC);

CREATE OR REPLACE FUNCTION platform.reject_governed_configuration_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'governed configuration history is immutable';
END;
$$;

CREATE TRIGGER configuration_setting_definitions_immutable
BEFORE UPDATE OR DELETE ON platform.configuration_setting_definitions
FOR EACH ROW EXECUTE FUNCTION platform.reject_governed_configuration_mutation();

CREATE TRIGGER configuration_setting_values_immutable
BEFORE UPDATE OR DELETE ON platform.configuration_setting_values
FOR EACH ROW EXECUTE FUNCTION platform.reject_governed_configuration_mutation();

ALTER TABLE platform.configuration_setting_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.configuration_setting_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.configuration_setting_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.configuration_setting_values FORCE ROW LEVEL SECURITY;

CREATE POLICY configuration_setting_definitions_select
  ON platform.configuration_setting_definitions
  FOR SELECT
  USING (true);

CREATE POLICY configuration_setting_values_select
  ON platform.configuration_setting_values
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = platform.current_tenant_id()
  );

CREATE POLICY configuration_setting_values_insert
  ON platform.configuration_setting_values
  FOR INSERT
  WITH CHECK (
    tenant_id = platform.current_tenant_id()
    AND level IN ('TENANT', 'BRAND', 'WORKSPACE', 'USER_PREFERENCE', 'OPERATIONAL')
  );

COMMIT;
