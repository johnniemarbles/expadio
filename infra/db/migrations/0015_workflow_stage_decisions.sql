BEGIN;

CREATE TABLE platform.workflow_stage_decisions (
  decision_id text PRIMARY KEY CHECK (btrim(decision_id) <> ''),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  instance_id uuid NOT NULL,
  work_type_key text NOT NULL CHECK (btrim(work_type_key) <> ''),
  stage_key text NOT NULL CHECK (btrim(stage_key) <> ''),
  outcome text NOT NULL CHECK (btrim(outcome) <> ''),
  decided_by_subject_id text NOT NULL CHECK (btrim(decided_by_subject_id) <> ''),
  decided_at timestamptz NOT NULL,
  code text NOT NULL CHECK (btrim(code) <> ''),
  evidence_refs text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (instance_id, tenant_id)
    REFERENCES platform.workflow_instances(instance_id, tenant_id)
    ON DELETE CASCADE,
  UNIQUE (tenant_id, instance_id, stage_key)
);

CREATE INDEX workflow_stage_decisions_tenant_instance_idx
  ON platform.workflow_stage_decisions (tenant_id, instance_id, stage_key);

CREATE OR REPLACE FUNCTION platform.reject_workflow_stage_decision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'workflow stage decisions are immutable';
END;
$$;

CREATE TRIGGER workflow_stage_decisions_immutable
BEFORE UPDATE OR DELETE ON platform.workflow_stage_decisions
FOR EACH ROW EXECUTE FUNCTION platform.reject_workflow_stage_decision_mutation();

ALTER TABLE platform.workflow_stage_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_stage_decisions FORCE ROW LEVEL SECURITY;

CREATE POLICY workflow_stage_decisions_select
  ON platform.workflow_stage_decisions
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY workflow_stage_decisions_insert
  ON platform.workflow_stage_decisions
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
