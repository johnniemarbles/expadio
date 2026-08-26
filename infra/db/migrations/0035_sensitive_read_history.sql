BEGIN;

CREATE TABLE platform.sensitive_read_events (
  event_id uuid PRIMARY KEY,
  request_id text NOT NULL CHECK (btrim(request_id) <> ''),
  tenant_id uuid NOT NULL
    REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  requested_by_subject_id text NOT NULL
    CHECK (btrim(requested_by_subject_id) <> ''),
  resource_type text NOT NULL CHECK (btrim(resource_type) <> ''),
  resource_id text NOT NULL CHECK (btrim(resource_id) <> ''),
  purpose text NOT NULL CHECK (btrim(purpose) <> ''),
  legal_basis text NOT NULL CHECK (btrim(legal_basis) <> ''),
  authorization_decision_id text NOT NULL
    CHECK (btrim(authorization_decision_id) <> ''),
  authorization_reason_key text NOT NULL
    CHECK (btrim(authorization_reason_key) <> ''),
  outcome text NOT NULL CHECK (outcome IN ('ALLOWED', 'DENIED', 'FAILED')),
  result_reference text,
  classifications text[] NOT NULL CHECK (
    array_position(classifications, NULL) IS NULL
  ),
  source_references text[] NOT NULL CHECK (
    array_position(source_references, NULL) IS NULL
  ),
  failure_reason_key text,
  requested_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  evidence_refs text[] NOT NULL CHECK (
    cardinality(evidence_refs) > 0
    AND array_position(evidence_refs, NULL) IS NULL
  ),
  UNIQUE (tenant_id, request_id),
  CHECK (recorded_at >= requested_at),
  CHECK (
    (outcome = 'ALLOWED'
      AND btrim(result_reference) <> ''
      AND cardinality(classifications) > 0
      AND cardinality(source_references) > 0
      AND failure_reason_key IS NULL)
    OR (outcome IN ('DENIED', 'FAILED')
      AND result_reference IS NULL
      AND cardinality(classifications) = 0
      AND cardinality(source_references) = 0
      AND btrim(failure_reason_key) <> '')
  )
);

CREATE INDEX sensitive_read_events_resource_idx
  ON platform.sensitive_read_events (
    tenant_id, resource_type, resource_id, recorded_at DESC
  );

CREATE INDEX sensitive_read_events_actor_idx
  ON platform.sensitive_read_events (
    tenant_id, requested_by_subject_id, recorded_at DESC
  );

CREATE OR REPLACE FUNCTION platform.reject_sensitive_read_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Sensitive read history is immutable';
END;
$$;

CREATE TRIGGER sensitive_read_events_immutable
BEFORE UPDATE OR DELETE ON platform.sensitive_read_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_sensitive_read_event_mutation();

ALTER TABLE platform.sensitive_read_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.sensitive_read_events FORCE ROW LEVEL SECURITY;

CREATE POLICY sensitive_read_events_select
  ON platform.sensitive_read_events
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY sensitive_read_events_insert
  ON platform.sensitive_read_events
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
