BEGIN;

-- Governed Action Execution Attempts
--
-- Action Intents remain immutable. Operational execution state is recorded
-- separately so retries, refusals, provider failures, and future worker claims
-- never rewrite what policy authorized.

ALTER TABLE platform.governed_action_intents
  ADD CONSTRAINT governed_action_intents_intent_tenant_uq
  UNIQUE (action_intent_id, tenant_id);

CREATE TABLE platform.governed_action_execution_attempts (
  execution_attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE RESTRICT,
  action_intent_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
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
  state text NOT NULL DEFAULT 'STARTED'
    CHECK (state IN ('STARTED','SUCCEEDED','REFUSED','FAILED')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  reason_code text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (action_intent_id, tenant_id)
    REFERENCES platform.governed_action_intents(action_intent_id, tenant_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, action_intent_id, attempt_number),
  CHECK (
    (state = 'STARTED' AND finished_at IS NULL)
    OR
    (state <> 'STARTED' AND finished_at IS NOT NULL)
  )
);

CREATE INDEX governed_action_execution_attempts_intent_idx
  ON platform.governed_action_execution_attempts (
    tenant_id,
    action_intent_id,
    attempt_number DESC
  );

CREATE INDEX governed_action_execution_attempts_state_idx
  ON platform.governed_action_execution_attempts (
    tenant_id,
    state,
    started_at
  );

ALTER TABLE platform.governed_action_execution_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.governed_action_execution_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY governed_action_execution_attempts_tenant_all
  ON platform.governed_action_execution_attempts
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
