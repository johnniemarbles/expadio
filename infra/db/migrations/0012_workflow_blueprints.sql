BEGIN;

CREATE TABLE platform.workflow_blueprints (
  blueprint_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  blueprint_key text NOT NULL CHECK (btrim(blueprint_key) <> ''),
  version integer NOT NULL CHECK (version > 0),
  label text NOT NULL CHECK (btrim(label) <> ''),
  work_type_key text NOT NULL CHECK (btrim(work_type_key) <> ''),
  source text NOT NULL CHECK (source IN ('PLATFORM','TENANT_CUSTOMIZED')),
  parent_blueprint_key text,
  parent_blueprint_version integer CHECK (parent_blueprint_version IS NULL OR parent_blueprint_version > 0),
  state text NOT NULL CHECK (state IN ('DRAFT','IN_REVIEW','ACTIVE','SUPERSEDED','ARCHIVED')),
  allows_stage_addition boolean NOT NULL DEFAULT false,
  allows_stage_reorder boolean NOT NULL DEFAULT false,
  allows_stage_deactivation boolean NOT NULL DEFAULT false,
  minimum_required_stage_keys text[] NOT NULL DEFAULT '{}',
  stages jsonb NOT NULL CHECK (jsonb_typeof(stages) = 'array'),
  published_by_subject_id text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_blueprints_scope_check CHECK (
    (source = 'PLATFORM' AND tenant_id IS NULL)
    OR
    (source = 'TENANT_CUSTOMIZED' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT workflow_blueprints_parent_identity_check CHECK (
    (parent_blueprint_key IS NULL AND parent_blueprint_version IS NULL)
    OR
    (parent_blueprint_key IS NOT NULL AND btrim(parent_blueprint_key) <> '' AND parent_blueprint_version IS NOT NULL)
  )
);

CREATE UNIQUE INDEX workflow_blueprints_platform_identity_uq
  ON platform.workflow_blueprints (blueprint_key, version)
  WHERE tenant_id IS NULL;

CREATE UNIQUE INDEX workflow_blueprints_tenant_identity_uq
  ON platform.workflow_blueprints (tenant_id, blueprint_key, version)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX workflow_blueprints_platform_lookup_idx
  ON platform.workflow_blueprints (blueprint_key, version DESC)
  WHERE tenant_id IS NULL;

CREATE INDEX workflow_blueprints_tenant_lookup_idx
  ON platform.workflow_blueprints (tenant_id, blueprint_key, version DESC)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE platform.workflow_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_blueprints FORCE ROW LEVEL SECURITY;

CREATE POLICY workflow_blueprints_select
  ON platform.workflow_blueprints
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = platform.current_tenant_id()
  );

CREATE POLICY workflow_blueprints_tenant_insert
  ON platform.workflow_blueprints
  FOR INSERT
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = platform.current_tenant_id()
  );

CREATE POLICY workflow_blueprints_tenant_update
  ON platform.workflow_blueprints
  FOR UPDATE
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = platform.current_tenant_id()
  )
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = platform.current_tenant_id()
  );

CREATE POLICY workflow_blueprints_tenant_delete
  ON platform.workflow_blueprints
  FOR DELETE
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = platform.current_tenant_id()
  );

COMMIT;
