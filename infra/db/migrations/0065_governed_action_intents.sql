BEGIN;

-- Governed Action Intents
--
-- An Action Intent records *what is permitted and requested* after a Domain
-- Event matches a rule and policy evaluation allows it. Execution attempts and
-- provider results are deliberately separate future records.

CREATE TABLE platform.governed_action_intents (
  action_intent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE RESTRICT,
  source_event_id uuid NOT NULL,
  source_event_type text NOT NULL CHECK (btrim(source_event_type) <> ''),
  aggregate_type text NOT NULL CHECK (btrim(aggregate_type) <> ''),
  aggregate_id text NOT NULL CHECK (btrim(aggregate_id) <> ''),
  rule_key text NOT NULL CHECK (btrim(rule_key) <> ''),
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
  action_key text NOT NULL CHECK (btrim(action_key) <> ''),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  correlation_id text NOT NULL CHECK (btrim(correlation_id) <> ''),
  causation_id text NOT NULL CHECK (btrim(causation_id) <> ''),
  requested_by_subject_id text NOT NULL CHECK (btrim(requested_by_subject_id) <> ''),
  requested_at timestamptz NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(configuration) = 'object'),
  policy_decision jsonb NOT NULL CHECK (
    jsonb_typeof(policy_decision) = 'object'
    AND policy_decision @> '{"allowed":true}'::jsonb
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (source_event_id, tenant_id)
    REFERENCES platform.domain_events(event_id, tenant_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, source_event_id, rule_key, executor_class),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX governed_action_intents_event_idx
  ON platform.governed_action_intents (
    tenant_id,
    source_event_id,
    created_at
  );

CREATE INDEX governed_action_intents_executor_idx
  ON platform.governed_action_intents (
    tenant_id,
    executor_class,
    created_at
  );

CREATE OR REPLACE FUNCTION platform.reject_governed_action_intent_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'governed action intents are append-only';
END;
$$;

CREATE TRIGGER governed_action_intents_append_only
BEFORE UPDATE OR DELETE ON platform.governed_action_intents
FOR EACH ROW EXECUTE FUNCTION platform.reject_governed_action_intent_mutation();

ALTER TABLE platform.governed_action_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.governed_action_intents FORCE ROW LEVEL SECURITY;

CREATE POLICY governed_action_intents_tenant_select
  ON platform.governed_action_intents
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY governed_action_intents_tenant_insert
  ON platform.governed_action_intents
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
