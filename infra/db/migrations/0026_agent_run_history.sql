BEGIN;

CREATE TABLE platform.agent_runs (
  run_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL
    REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  agent_id text NOT NULL CHECK (btrim(agent_id) <> ''),
  purpose text NOT NULL CHECK (btrim(purpose) <> ''),
  context_bundle_reference text NOT NULL
    CHECK (btrim(context_bundle_reference) <> ''),
  budget_policy_reference text NOT NULL
    CHECK (btrim(budget_policy_reference) <> ''),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  requested_by_subject_id text NOT NULL
    CHECK (btrim(requested_by_subject_id) <> ''),
  requested_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  correlation_id uuid NOT NULL,
  evidence_refs text[] NOT NULL CHECK (
    cardinality(evidence_refs) > 0
    AND array_position(evidence_refs, NULL) IS NULL
  ),
  UNIQUE (run_id, tenant_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE platform.agent_run_events (
  event_id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL CHECK (event_type IN (
    'STARTED',
    'CONTEXT_AUTHORIZED',
    'TOOL_AUTHORIZED',
    'BUDGET_RESERVED',
    'PROPOSAL_CREATED',
    'APPROVED',
    'REJECTED',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED'
  )),
  event_reference text NOT NULL CHECK (btrim(event_reference) <> ''),
  occurred_at timestamptz NOT NULL,
  actor_subject_id text NOT NULL CHECK (btrim(actor_subject_id) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  correlation_id uuid NOT NULL,
  evidence_refs text[] NOT NULL CHECK (
    cardinality(evidence_refs) > 0
    AND array_position(evidence_refs, NULL) IS NULL
  ),
  cost_minor_units integer CHECK (
    cost_minor_units IS NULL OR cost_minor_units >= 0
  ),
  FOREIGN KEY (run_id, tenant_id)
    REFERENCES platform.agent_runs(run_id, tenant_id),
  UNIQUE (run_id, sequence)
);

CREATE INDEX agent_runs_tenant_created_idx
  ON platform.agent_runs (tenant_id, created_at DESC, run_id);

CREATE INDEX agent_run_events_tenant_run_idx
  ON platform.agent_run_events (tenant_id, run_id, sequence);

CREATE OR REPLACE FUNCTION platform.reject_agent_run_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Agent run history is immutable';
END;
$$;

CREATE OR REPLACE FUNCTION platform.enforce_agent_run_event_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_sequence integer;
BEGIN
  PERFORM 1
    FROM platform.agent_runs
   WHERE run_id = NEW.run_id
     AND tenant_id = NEW.tenant_id
   FOR UPDATE;

  SELECT COALESCE(max(sequence), 0) + 1
    INTO expected_sequence
    FROM platform.agent_run_events
   WHERE run_id = NEW.run_id;

  IF NEW.sequence <> expected_sequence THEN
    RAISE EXCEPTION
      'Agent run event sequence must be %, received %',
      expected_sequence,
      NEW.sequence;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_runs_immutable
BEFORE UPDATE OR DELETE ON platform.agent_runs
FOR EACH ROW EXECUTE FUNCTION platform.reject_agent_run_history_mutation();

CREATE TRIGGER agent_run_events_immutable
BEFORE UPDATE OR DELETE ON platform.agent_run_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_agent_run_history_mutation();

CREATE TRIGGER agent_run_events_sequenced
BEFORE INSERT ON platform.agent_run_events
FOR EACH ROW EXECUTE FUNCTION platform.enforce_agent_run_event_sequence();

ALTER TABLE platform.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.agent_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.agent_run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.agent_run_events FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_runs_select
  ON platform.agent_runs
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY agent_runs_insert
  ON platform.agent_runs
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY agent_run_events_select
  ON platform.agent_run_events
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY agent_run_events_insert
  ON platform.agent_run_events
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
