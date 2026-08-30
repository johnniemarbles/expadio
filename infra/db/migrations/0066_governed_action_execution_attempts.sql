BEGIN;

-- Governed Action Execution Attempts
--
-- Each row is one immutable executor outcome. Claim/lease state for future
-- workers belongs to a separate queue/worker concern and does not mutate the
-- Action Intent or rewrite a completed attempt.

ALTER TABLE platform.governed_action_intents
  ADD CONSTRAINT governed_action_intents_intent_tenant_uq
  UNIQUE (action_intent_id, tenant_id);

CREATE TABLE platform.governed_action_execution_attempts (
  execution_attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE RESTRICT,
  action_intent_id uuid NOT NULL,
  executor_class text NOT NULL CHECK (
    executor_class IN (
      'COMMUNICATE',
      'ASSIGN',
      'CREATE_TASK',
      'START_WORKFLOW',
      'ADVANCE_WORKFLOW',
      'CREATE_DOCUMENT',
      'REQUEST_APPROVAL',
      'WEBHOOK',
      'INTEGRATION',
      'AI_ACTION',
      'SCHEDULE'
    )
  ),
  attempt_key text NOT NULL CHECK (btrim(attempt_key) <> ''),
  status text NOT NULL CHECK (
    status IN ('QUEUED','SUCCEEDED','REFUSED','FAILED','RETRYABLE')
  ),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  reason_code text NOT NULL CHECK (btrim(reason_code) <> ''),
  reason text,
  output_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (action_intent_id, tenant_id)
    REFERENCES platform.governed_action_intents(action_intent_id, tenant_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, action_intent_id, attempt_key)
);

CREATE INDEX governed_action_execution_attempts_intent_idx
  ON platform.governed_action_execution_attempts (
    tenant_id,
    action_intent_id,
    created_at
  );

CREATE INDEX governed_action_execution_attempts_status_idx
  ON platform.governed_action_execution_attempts (
    tenant_id,
    executor_class,
    status,
    created_at
  );

CREATE OR REPLACE FUNCTION platform.reject_governed_action_execution_attempt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'governed action execution attempts are append-only';
END;
$$;

CREATE TRIGGER governed_action_execution_attempts_append_only
BEFORE UPDATE OR DELETE ON platform.governed_action_execution_attempts
FOR EACH ROW EXECUTE FUNCTION platform.reject_governed_action_execution_attempt_mutation();

ALTER TABLE platform.governed_action_execution_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.governed_action_execution_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY governed_action_execution_attempts_tenant_select
  ON platform.governed_action_execution_attempts
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY governed_action_execution_attempts_tenant_insert
  ON platform.governed_action_execution_attempts
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
