BEGIN;

CREATE TABLE platform.communication_legacy_delivery_recovery_events (
  recovery_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE RESTRICT,
  delivery_id uuid NOT NULL,
  previous_state text NOT NULL CHECK (previous_state = 'PENDING'),
  resolution text NOT NULL CHECK (resolution = 'CANCELLED'),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  authorized_by_subject_id text NOT NULL CHECK (btrim(authorized_by_subject_id) <> ''),
  authorized_by_role_key text NOT NULL CHECK (btrim(authorized_by_role_key) <> ''),
  correlation_id uuid NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (delivery_id, tenant_id)
    REFERENCES platform.communication_deliveries(delivery_id, tenant_id)
    ON DELETE RESTRICT
);

CREATE INDEX communication_legacy_delivery_recovery_tenant_idx
  ON platform.communication_legacy_delivery_recovery_events (
    tenant_id, resolved_at DESC, recovery_event_id
  );

CREATE UNIQUE INDEX communication_legacy_delivery_recovery_once_idx
  ON platform.communication_legacy_delivery_recovery_events (tenant_id, delivery_id);

CREATE OR REPLACE FUNCTION platform.reject_communication_legacy_recovery_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'communication legacy delivery recovery records are append-only';
END;
$$;

CREATE TRIGGER communication_legacy_delivery_recovery_append_only
BEFORE UPDATE OR DELETE ON platform.communication_legacy_delivery_recovery_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_communication_legacy_recovery_mutation();

ALTER TABLE platform.communication_legacy_delivery_recovery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_legacy_delivery_recovery_events FORCE ROW LEVEL SECURITY;

CREATE POLICY communication_legacy_delivery_recovery_tenant_select
  ON platform.communication_legacy_delivery_recovery_events
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY communication_legacy_delivery_recovery_tenant_insert
  ON platform.communication_legacy_delivery_recovery_events
  FOR INSERT WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
