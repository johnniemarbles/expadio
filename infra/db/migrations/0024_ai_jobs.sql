BEGIN;

CREATE TABLE platform.ai_jobs (
  job_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL
    REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  invocation_id text NOT NULL CHECK (btrim(invocation_id) <> ''),
  operation text NOT NULL CHECK (operation IN (
    'GENERATE', 'CLASSIFY', 'SUMMARIZE', 'EXTRACT',
    'EMBED', 'RERANK', 'VISION_ANALYZE', 'TRANSLATE'
  )),
  purpose text NOT NULL CHECK (btrim(purpose) <> ''),
  input_reference text NOT NULL CHECK (btrim(input_reference) <> ''),
  context_reference text,
  prompt_configuration_key text NOT NULL
    CHECK (btrim(prompt_configuration_key) <> ''),
  prompt_configuration_version integer NOT NULL
    CHECK (prompt_configuration_version > 0),
  required_residency_tags text[] NOT NULL
    CHECK (array_position(required_residency_tags, NULL) IS NULL),
  required_compliance_tags text[] NOT NULL
    CHECK (array_position(required_compliance_tags, NULL) IS NULL),
  maximum_cost_minor_units integer
    CHECK (maximum_cost_minor_units >= 0),
  maximum_attempts integer NOT NULL CHECK (maximum_attempts > 0),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  created_by_subject_id text NOT NULL
    CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  correlation_id uuid NOT NULL,
  evidence_refs text[] NOT NULL CHECK (
    cardinality(evidence_refs) > 0
    AND array_position(evidence_refs, NULL) IS NULL
  ),
  UNIQUE (job_id, tenant_id),
  UNIQUE (tenant_id, invocation_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE platform.ai_job_events (
  event_id uuid PRIMARY KEY,
  job_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL CHECK (event_type IN (
    'STARTED', 'SUCCEEDED', 'FAILED', 'RETRY_SCHEDULED', 'CANCELLED'
  )),
  occurred_at timestamptz NOT NULL,
  actor_subject_id text NOT NULL CHECK (btrim(actor_subject_id) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  correlation_id uuid NOT NULL,
  evidence_refs text[] NOT NULL CHECK (
    cardinality(evidence_refs) > 0
    AND array_position(evidence_refs, NULL) IS NULL
  ),
  output_reference text,
  confidence double precision CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  ),
  cost_minor_units integer CHECK (
    cost_minor_units IS NULL OR cost_minor_units >= 0
  ),
  failure_code text,
  next_attempt_at timestamptz,
  FOREIGN KEY (job_id, tenant_id)
    REFERENCES platform.ai_jobs(job_id, tenant_id),
  UNIQUE (job_id, sequence),
  CHECK (
    (event_type = 'STARTED'
      AND output_reference IS NULL
      AND confidence IS NULL
      AND cost_minor_units IS NULL
      AND failure_code IS NULL
      AND next_attempt_at IS NULL)
    OR (event_type = 'SUCCEEDED'
      AND btrim(output_reference) <> ''
      AND failure_code IS NULL
      AND next_attempt_at IS NULL)
    OR (event_type = 'FAILED'
      AND btrim(failure_code) <> ''
      AND output_reference IS NULL
      AND confidence IS NULL
      AND cost_minor_units IS NULL
      AND next_attempt_at IS NULL)
    OR (event_type = 'RETRY_SCHEDULED'
      AND next_attempt_at IS NOT NULL
      AND output_reference IS NULL
      AND confidence IS NULL
      AND cost_minor_units IS NULL
      AND failure_code IS NULL)
    OR (event_type = 'CANCELLED'
      AND output_reference IS NULL
      AND confidence IS NULL
      AND cost_minor_units IS NULL
      AND failure_code IS NULL
      AND next_attempt_at IS NULL)
  )
);

CREATE INDEX ai_jobs_tenant_created_idx
  ON platform.ai_jobs (tenant_id, created_at DESC, job_id);

CREATE INDEX ai_job_events_tenant_job_idx
  ON platform.ai_job_events (tenant_id, job_id, sequence);

CREATE OR REPLACE FUNCTION platform.reject_ai_job_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AI job history is immutable';
END;
$$;

CREATE OR REPLACE FUNCTION platform.enforce_ai_job_event_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_sequence integer;
BEGIN
  PERFORM 1
    FROM platform.ai_jobs
   WHERE job_id = NEW.job_id
     AND tenant_id = NEW.tenant_id
   FOR UPDATE;

  SELECT COALESCE(max(sequence), 0) + 1
    INTO expected_sequence
    FROM platform.ai_job_events
   WHERE job_id = NEW.job_id;

  IF NEW.sequence <> expected_sequence THEN
    RAISE EXCEPTION
      'AI job event sequence must be %, received %',
      expected_sequence,
      NEW.sequence;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_jobs_immutable
BEFORE UPDATE OR DELETE ON platform.ai_jobs
FOR EACH ROW EXECUTE FUNCTION platform.reject_ai_job_history_mutation();

CREATE TRIGGER ai_job_events_immutable
BEFORE UPDATE OR DELETE ON platform.ai_job_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_ai_job_history_mutation();

CREATE TRIGGER ai_job_events_sequenced
BEFORE INSERT ON platform.ai_job_events
FOR EACH ROW EXECUTE FUNCTION platform.enforce_ai_job_event_sequence();

ALTER TABLE platform.ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_job_events FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_jobs_select
  ON platform.ai_jobs
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY ai_jobs_insert
  ON platform.ai_jobs
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY ai_job_events_select
  ON platform.ai_job_events
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY ai_job_events_insert
  ON platform.ai_job_events
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
