BEGIN;

ALTER TABLE platform.communication_deliveries
  ADD CONSTRAINT communication_deliveries_id_tenant_unique
  UNIQUE (delivery_id, tenant_id);

CREATE TABLE platform.communication_provider_attempts (
  provider_attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  attempt_token uuid NOT NULL,
  connector_key text NOT NULL CHECK (btrim(connector_key) <> ''),
  provider_key text NOT NULL CHECK (btrim(provider_key) <> ''),
  adapter_key text NOT NULL CHECK (btrim(adapter_key) <> ''),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  outcome text NOT NULL CHECK (
    outcome IN ('ACCEPTED','RETRYABLE_FAILURE','REJECTED','ERROR')
  ),
  provider_message_id text NULL,
  reason_code text NOT NULL CHECK (btrim(reason_code) <> ''),
  reason text NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (delivery_id, tenant_id)
    REFERENCES platform.communication_deliveries(delivery_id, tenant_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, delivery_id, attempt_token),
  CHECK (completed_at >= started_at),
  CHECK (
    (outcome = 'ACCEPTED' AND provider_message_id IS NOT NULL AND btrim(provider_message_id) <> '')
    OR outcome <> 'ACCEPTED'
  )
);

CREATE INDEX communication_provider_attempts_reconcile_idx
  ON platform.communication_provider_attempts (
    tenant_id, delivery_id, completed_at
  )
  WHERE outcome = 'ACCEPTED';

ALTER TABLE platform.communication_provider_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_provider_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY communication_provider_attempts_tenant_select
  ON platform.communication_provider_attempts
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY communication_provider_attempts_tenant_insert
  ON platform.communication_provider_attempts
  FOR INSERT WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE OR REPLACE FUNCTION platform.reject_communication_provider_attempt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'communication provider attempts are append-only';
END;
$$;

CREATE TRIGGER communication_provider_attempts_append_only
BEFORE UPDATE OR DELETE ON platform.communication_provider_attempts
FOR EACH ROW EXECUTE FUNCTION platform.reject_communication_provider_attempt_mutation();

COMMIT;
