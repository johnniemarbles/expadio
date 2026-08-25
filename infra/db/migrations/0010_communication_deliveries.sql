BEGIN;

CREATE TABLE platform.communication_deliveries (
  delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid,
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  channel text NOT NULL CHECK (channel IN ('email','sms','whatsapp','voice','in_app','push','rcs')),
  connector_key text NOT NULL CHECK (btrim(connector_key) <> ''),
  adapter_key text NOT NULL CHECK (btrim(adapter_key) <> ''),
  provider_message_id text,
  state text NOT NULL DEFAULT 'PENDING'
    CHECK (state IN ('PENDING','ACCEPTED','SENT','DELIVERED','FAILED','BOUNCED','COMPLAINED','CANCELLED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_reason_code text,
  last_reason text,
  requested_at timestamptz NOT NULL,
  accepted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX communication_deliveries_provider_message_idx
  ON platform.communication_deliveries (connector_key, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE platform.communication_delivery_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES platform.communication_deliveries(delivery_id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  from_state text NOT NULL CHECK (from_state IN ('PENDING','ACCEPTED','SENT','DELIVERED','FAILED','BOUNCED','COMPLAINED','CANCELLED')),
  to_state text NOT NULL CHECK (to_state IN ('PENDING','ACCEPTED','SENT','DELIVERED','FAILED','BOUNCED','COMPLAINED','CANCELLED')),
  provider_event_id text,
  reason_code text,
  reason text,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (delivery_id, tenant_id)
    REFERENCES platform.communication_deliveries(delivery_id, tenant_id)
    ON DELETE CASCADE,
  UNIQUE (tenant_id, provider_event_id)
);

ALTER TABLE platform.communication_deliveries
  ADD CONSTRAINT communication_deliveries_id_tenant_uq UNIQUE (delivery_id, tenant_id);

CREATE OR REPLACE FUNCTION platform.reject_communication_delivery_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'communication delivery events are append-only';
END;
$$;

CREATE TRIGGER communication_delivery_events_append_only
BEFORE UPDATE OR DELETE ON platform.communication_delivery_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_communication_delivery_event_mutation();

ALTER TABLE platform.communication_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_delivery_events FORCE ROW LEVEL SECURITY;

CREATE POLICY communication_deliveries_tenant_all
  ON platform.communication_deliveries
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY communication_delivery_events_tenant_select
  ON platform.communication_delivery_events
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY communication_delivery_events_tenant_insert
  ON platform.communication_delivery_events
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
