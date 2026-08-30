BEGIN;

CREATE TABLE platform.communication_provider_webhook_events (
  webhook_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE RESTRICT,
  provider_key text NOT NULL CHECK (btrim(provider_key) <> ''),
  connector_key text NOT NULL CHECK (btrim(connector_key) <> ''),
  provider_event_id text NOT NULL CHECK (btrim(provider_event_id) <> ''),
  provider_message_id text NULL CHECK (provider_message_id IS NULL OR btrim(provider_message_id) <> ''),
  event_type text NOT NULL CHECK (btrim(event_type) <> ''),
  normalized_outcome text NOT NULL CHECK (
    normalized_outcome IN (
      'SENT',
      'DELIVERED',
      'BOUNCED',
      'COMPLAINED',
      'FAILED',
      'IGNORED',
      'UNMATCHED'
    )
  ),
  delivery_id uuid NULL,
  previous_delivery_state text NULL CHECK (
    previous_delivery_state IS NULL
    OR previous_delivery_state IN (
      'PENDING','ACCEPTED','SENT','DELIVERED','FAILED','BOUNCED','COMPLAINED','CANCELLED'
    )
  ),
  new_delivery_state text NULL CHECK (
    new_delivery_state IS NULL
    OR new_delivery_state IN (
      'PENDING','ACCEPTED','SENT','DELIVERED','FAILED','BOUNCED','COMPLAINED','CANCELLED'
    )
  ),
  reason_code text NOT NULL CHECK (btrim(reason_code) <> ''),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  received_at timestamptz NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (delivery_id, tenant_id)
    REFERENCES platform.communication_deliveries(delivery_id, tenant_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, provider_key, provider_event_id),
  CHECK (
    (delivery_id IS NULL AND previous_delivery_state IS NULL AND new_delivery_state IS NULL)
    OR
    (delivery_id IS NOT NULL AND previous_delivery_state IS NOT NULL AND new_delivery_state IS NOT NULL)
  )
);

CREATE INDEX communication_provider_webhook_events_message_idx
  ON platform.communication_provider_webhook_events (
    tenant_id, provider_key, provider_message_id, processed_at DESC
  )
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX communication_provider_webhook_events_delivery_idx
  ON platform.communication_provider_webhook_events (
    tenant_id, delivery_id, processed_at DESC
  )
  WHERE delivery_id IS NOT NULL;

ALTER TABLE platform.communication_provider_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_provider_webhook_events FORCE ROW LEVEL SECURITY;

CREATE POLICY communication_provider_webhook_events_tenant_select
  ON platform.communication_provider_webhook_events
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY communication_provider_webhook_events_tenant_insert
  ON platform.communication_provider_webhook_events
  FOR INSERT WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE OR REPLACE FUNCTION platform.reject_communication_provider_webhook_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'communication provider webhook events are append-only';
END;
$$;

CREATE TRIGGER communication_provider_webhook_events_append_only
BEFORE UPDATE OR DELETE ON platform.communication_provider_webhook_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_communication_provider_webhook_event_mutation();

COMMIT;
