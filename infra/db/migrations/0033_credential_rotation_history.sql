BEGIN;

CREATE TABLE platform.credential_rotation_events (
  event_id uuid PRIMARY KEY,
  rotation_reference text NOT NULL CHECK (btrim(rotation_reference) <> ''),
  sequence integer NOT NULL CHECK (sequence > 0),
  request_id text NOT NULL CHECK (btrim(request_id) <> ''),
  tenant_id uuid NOT NULL
    REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  requested_by_subject_id text NOT NULL
    CHECK (btrim(requested_by_subject_id) <> ''),
  connector_key text NOT NULL CHECK (btrim(connector_key) <> ''),
  current_credential_reference text NOT NULL CHECK (
    current_credential_reference ~
      '^(secret|vault|kms|provider-secret)://[^[:space:]]+$'
  ),
  replacement_credential_reference text NOT NULL CHECK (
    replacement_credential_reference ~
      '^(secret|vault|kms|provider-secret)://[^[:space:]]+$'
  ),
  event_type text NOT NULL CHECK (
    event_type IN ('STAGED', 'ACTIVATED', 'REVOKED')
  ),
  authorization_decision_id text NOT NULL
    CHECK (btrim(authorization_decision_id) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  occurred_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  evidence_refs text[] NOT NULL CHECK (
    cardinality(evidence_refs) > 0
    AND array_position(evidence_refs, NULL) IS NULL
  ),
  UNIQUE (tenant_id, rotation_reference, sequence),
  CHECK (current_credential_reference <> replacement_credential_reference),
  CHECK ((sequence = 1) = (event_type = 'STAGED'))
);

CREATE UNIQUE INDEX credential_rotation_events_stage_request_idx
  ON platform.credential_rotation_events (tenant_id, request_id)
  WHERE event_type = 'STAGED';

CREATE INDEX credential_rotation_events_connector_idx
  ON platform.credential_rotation_events (
    tenant_id, connector_key, occurred_at DESC
  );

CREATE OR REPLACE FUNCTION platform.reject_credential_rotation_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Credential rotation history is immutable';
END;
$$;

CREATE TRIGGER credential_rotation_events_immutable
BEFORE UPDATE OR DELETE ON platform.credential_rotation_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_credential_rotation_event_mutation();

ALTER TABLE platform.credential_rotation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.credential_rotation_events FORCE ROW LEVEL SECURITY;

CREATE POLICY credential_rotation_events_select
  ON platform.credential_rotation_events
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY credential_rotation_events_insert
  ON platform.credential_rotation_events
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
