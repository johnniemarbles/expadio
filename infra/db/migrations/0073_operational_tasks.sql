BEGIN;

CREATE TABLE platform.operational_tasks (
  task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE RESTRICT,
  source_action_intent_id uuid NOT NULL,
  source_event_id uuid NOT NULL,
  aggregate_type text NOT NULL CHECK (btrim(aggregate_type) <> ''),
  aggregate_id text NOT NULL CHECK (btrim(aggregate_id) <> ''),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text NULL,
  assignee_subject_id text NULL CHECK (assignee_subject_id IS NULL OR btrim(assignee_subject_id) <> ''),
  due_at timestamptz NULL,
  priority text NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','COMPLETED','CANCELLED')),
  correlation_id text NOT NULL CHECK (btrim(correlation_id) <> ''),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (source_action_intent_id, tenant_id)
    REFERENCES platform.governed_action_intents(action_intent_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (source_event_id, tenant_id)
    REFERENCES platform.domain_events(event_id, tenant_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, source_action_intent_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX operational_tasks_status_due_idx
  ON platform.operational_tasks (tenant_id, status, due_at, created_at);

CREATE INDEX operational_tasks_assignee_idx
  ON platform.operational_tasks (tenant_id, assignee_subject_id, status, created_at)
  WHERE assignee_subject_id IS NOT NULL;

ALTER TABLE platform.operational_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.operational_tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY operational_tasks_tenant_select
  ON platform.operational_tasks
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY operational_tasks_tenant_insert
  ON platform.operational_tasks
  FOR INSERT WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY operational_tasks_tenant_update
  ON platform.operational_tasks
  FOR UPDATE
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
