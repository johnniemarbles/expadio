BEGIN;

CREATE TABLE platform.workflow_instances (
  instance_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  work_type_key text NOT NULL CHECK (btrim(work_type_key) <> ''),
  subject_type text NOT NULL CHECK (btrim(subject_type) <> ''),
  subject_id text NOT NULL CHECK (btrim(subject_id) <> ''),
  blueprint_key text NOT NULL CHECK (btrim(blueprint_key) <> ''),
  blueprint_version integer NOT NULL CHECK (blueprint_version > 0),
  blueprint_scope text NOT NULL CHECK (blueprint_scope IN ('PLATFORM','TENANT')),
  state text NOT NULL CHECK (state IN ('CREATED','RUNNING','PAUSED','COMPLETED','CANCELLED','FAILED')),
  current_stage_key text,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL,
  CONSTRAINT workflow_instances_stage_key_check CHECK (
    current_stage_key IS NULL OR btrim(current_stage_key) <> ''
  ),
  CONSTRAINT workflow_instances_completion_check CHECK (
    (state = 'COMPLETED' AND completed_at IS NOT NULL)
    OR state <> 'COMPLETED'
  ),
  UNIQUE (instance_id, tenant_id)
);

CREATE INDEX workflow_instances_tenant_subject_idx
  ON platform.workflow_instances (tenant_id, subject_type, subject_id, updated_at DESC);

CREATE INDEX workflow_instances_tenant_work_type_idx
  ON platform.workflow_instances (tenant_id, work_type_key, updated_at DESC);

CREATE TABLE platform.workflow_instance_transitions (
  transition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  from_stage_key text,
  to_stage_key text NOT NULL CHECK (btrim(to_stage_key) <> ''),
  from_state text NOT NULL CHECK (from_state IN ('CREATED','RUNNING','PAUSED','COMPLETED','CANCELLED','FAILED')),
  to_state text NOT NULL CHECK (to_state IN ('CREATED','RUNNING','PAUSED','COMPLETED','CANCELLED','FAILED')),
  revision integer NOT NULL CHECK (revision > 0),
  transitioned_by_subject_id text NOT NULL CHECK (btrim(transitioned_by_subject_id) <> ''),
  transitioned_at timestamptz NOT NULL,
  reason text,
  FOREIGN KEY (instance_id, tenant_id)
    REFERENCES platform.workflow_instances(instance_id, tenant_id)
    ON DELETE CASCADE,
  UNIQUE (instance_id, revision),
  CONSTRAINT workflow_instance_transitions_from_stage_check CHECK (
    from_stage_key IS NULL OR btrim(from_stage_key) <> ''
  )
);

CREATE INDEX workflow_instance_transitions_tenant_instance_idx
  ON platform.workflow_instance_transitions (tenant_id, instance_id, revision);

CREATE OR REPLACE FUNCTION platform.reject_workflow_transition_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'workflow instance transitions are append-only';
END;
$$;

CREATE TRIGGER workflow_instance_transitions_append_only
BEFORE UPDATE OR DELETE ON platform.workflow_instance_transitions
FOR EACH ROW EXECUTE FUNCTION platform.reject_workflow_transition_mutation();

ALTER TABLE platform.workflow_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_instances FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_instance_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_instance_transitions FORCE ROW LEVEL SECURITY;

CREATE POLICY workflow_instances_tenant_all
  ON platform.workflow_instances
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY workflow_instance_transitions_select
  ON platform.workflow_instance_transitions
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY workflow_instance_transitions_insert
  ON platform.workflow_instance_transitions
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
