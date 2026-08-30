BEGIN;

CREATE TABLE platform.scheduled_governed_actions (
  scheduled_action_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE RESTRICT,
  parent_action_intent_id uuid NOT NULL,
  due_at timestamptz NOT NULL,
  target_executor_class text NOT NULL CHECK (
    target_executor_class IN (
      'COMMUNICATE','ASSIGN','CREATE_TASK','START_WORKFLOW','ADVANCE_WORKFLOW',
      'CREATE_DOCUMENT','REQUEST_APPROVAL','WEBHOOK','INTEGRATION','AI_ACTION'
    )
  ),
  target_action_key text NOT NULL CHECK (btrim(target_action_key) <> ''),
  target_configuration jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(target_configuration) = 'object'),
  target_idempotency_key text NOT NULL CHECK (btrim(target_idempotency_key) <> ''),
  state text NOT NULL DEFAULT 'PENDING'
    CHECK (state IN ('PENDING','MATERIALIZED','FAILED','CANCELLED')),
  child_action_intent_id uuid NULL,
  claim_token uuid NULL,
  claim_expires_at timestamptz NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at timestamptz NULL,
  last_reason_code text NULL,
  last_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (parent_action_intent_id, tenant_id)
    REFERENCES platform.governed_action_intents(action_intent_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (child_action_intent_id, tenant_id)
    REFERENCES platform.governed_action_intents(action_intent_id, tenant_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, parent_action_intent_id),
  UNIQUE (tenant_id, target_idempotency_key),
  CHECK ((claim_token IS NULL) = (claim_expires_at IS NULL))
);

CREATE INDEX scheduled_governed_actions_due_idx
  ON platform.scheduled_governed_actions (tenant_id, due_at, scheduled_action_id)
  WHERE state = 'PENDING';

ALTER TABLE platform.scheduled_governed_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.scheduled_governed_actions FORCE ROW LEVEL SECURITY;

CREATE POLICY scheduled_governed_actions_tenant_select
  ON platform.scheduled_governed_actions
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY scheduled_governed_actions_tenant_insert
  ON platform.scheduled_governed_actions
  FOR INSERT WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY scheduled_governed_actions_tenant_update
  ON platform.scheduled_governed_actions
  FOR UPDATE
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
