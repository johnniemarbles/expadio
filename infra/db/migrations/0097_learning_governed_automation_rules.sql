BEGIN;

-- LMS-07 — tenant Learning governed-action automation configuration.
--
-- This is deliberately configuration only. Domain Events, outbox leasing,
-- governed Action Intents, execution attempts, scheduling, tasks and
-- communications continue to use the shared EXPADIO execution spine.

CREATE TABLE platform.learning_automation_rules (
  automation_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  rule_key text NOT NULL CHECK (
    rule_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  ),
  event_type text NOT NULL CHECK (
    event_type ~ '^learning\.[a-z0-9]+([._-][a-z0-9]+)*$'
  ),
  executor_class text NOT NULL CHECK (
    executor_class IN ('CREATE_TASK','COMMUNICATE','SCHEDULE')
  ),
  action_key text NOT NULL CHECK (
    action_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  ),
  enabled boolean NOT NULL DEFAULT true,
  policy_keys jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(policy_keys) = 'array'
  ),
  CONSTRAINT learning_automation_enabled_policy_evaluator CHECK (
    enabled = false OR jsonb_array_length(policy_keys) = 0
  ),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(configuration) = 'object'
  ),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  updated_by_subject_id text NOT NULL CHECK (btrim(updated_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (automation_rule_id, tenant_id),
  UNIQUE (tenant_id, rule_key)
);

CREATE INDEX learning_automation_rules_event_idx
  ON platform.learning_automation_rules(
    tenant_id, event_type, enabled, rule_key
  );

CREATE OR REPLACE FUNCTION platform.enforce_learning_automation_rule_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.rule_key IS DISTINCT FROM NEW.rule_key
     OR OLD.created_by_subject_id IS DISTINCT FROM NEW.created_by_subject_id
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'learning automation rule identity and creation provenance are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'learning automation rule revision must increment exactly once'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_automation_rules_revision_guard
BEFORE UPDATE ON platform.learning_automation_rules
FOR EACH ROW EXECUTE FUNCTION platform.enforce_learning_automation_rule_revision();

ALTER TABLE platform.learning_automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_automation_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY learning_automation_rules_tenant_isolation
  ON platform.learning_automation_rules
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
