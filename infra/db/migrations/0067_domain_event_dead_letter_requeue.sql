BEGIN;

-- Manual recovery evidence for terminal Domain Event outbox rows.
-- Domain Events remain immutable; this table records each operator-authorized
-- decision to start a new delivery retry cycle for a DEAD outbox row.

CREATE TABLE platform.domain_event_outbox_requeue_events (
  requeue_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE RESTRICT,
  outbox_id uuid NOT NULL,
  event_id uuid NOT NULL,
  previous_status text NOT NULL CHECK (previous_status = 'DEAD'),
  previous_attempts integer NOT NULL CHECK (previous_attempts >= 0),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  authorized_by_subject_id text NOT NULL CHECK (btrim(authorized_by_subject_id) <> ''),
  authorized_by_role_key text NOT NULL CHECK (btrim(authorized_by_role_key) <> ''),
  correlation_id uuid NOT NULL,
  requeued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (outbox_id, tenant_id)
    REFERENCES platform.domain_event_outbox(outbox_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (event_id, tenant_id)
    REFERENCES platform.domain_events(event_id, tenant_id)
    ON DELETE RESTRICT
);

CREATE INDEX domain_event_outbox_requeue_events_outbox_idx
  ON platform.domain_event_outbox_requeue_events (
    tenant_id,
    outbox_id,
    requeued_at DESC
  );

CREATE OR REPLACE FUNCTION platform.reject_domain_event_requeue_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'domain event requeue audit records are append-only';
END;
$$;

CREATE TRIGGER domain_event_outbox_requeue_events_append_only
BEFORE UPDATE OR DELETE ON platform.domain_event_outbox_requeue_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_domain_event_requeue_audit_mutation();

ALTER TABLE platform.domain_event_outbox_requeue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.domain_event_outbox_requeue_events FORCE ROW LEVEL SECURITY;

CREATE POLICY domain_event_outbox_requeue_events_tenant_select
  ON platform.domain_event_outbox_requeue_events
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY domain_event_outbox_requeue_events_tenant_insert
  ON platform.domain_event_outbox_requeue_events
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
