BEGIN;

-- Governed Recovery Command Model
--
-- This is the neutral command spine for operator-authorized recovery actions.
-- It does not execute recovery behavior by itself. Future queue/API/command-center
-- slices can claim and process these rows while preserving append-only evidence in
-- platform.governed_recovery_command_events.

CREATE TABLE platform.governed_recovery_commands (
  recovery_command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  command_type text NOT NULL CHECK (
    command_type IN ('RETRY', 'CANCEL', 'MARK_RESOLVED', 'CREATE_TASK_ESCALATION')
  ),
  target_kind text NOT NULL CHECK (
    target_kind IN (
      'DOMAIN_EVENT_OUTBOX',
      'GOVERNED_ACTION',
      'SCHEDULED_GOVERNED_ACTION',
      'COMMUNICATION_DELIVERY',
      'COMMUNICATION_PROVIDER_ATTEMPT',
      'COMMUNICATION_PROVIDER_WEBHOOK_EVENT'
    )
  ),
  target_id uuid NOT NULL,
  target_ref jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(target_ref) = 'object'),
  command_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(command_payload) = 'object'),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (
    status IN ('QUEUED', 'CLAIMED', 'SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELLED')
  ),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  requested_by_subject_id text NOT NULL CHECK (btrim(requested_by_subject_id) <> ''),
  requested_by_role_key text NOT NULL CHECK (btrim(requested_by_role_key) <> ''),
  correlation_id uuid NOT NULL,
  claim_token uuid,
  claim_expires_at timestamptz,
  claimed_at timestamptz,
  processed_at timestamptz,
  last_error text,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (recovery_command_id, tenant_id),
  CHECK (
    (claim_token IS NULL AND claim_expires_at IS NULL AND claimed_at IS NULL)
    OR
    (claim_token IS NOT NULL AND claim_expires_at IS NOT NULL AND claimed_at IS NOT NULL)
  ),
  CHECK (
    status NOT IN ('SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELLED')
    OR processed_at IS NOT NULL
  ),
  CHECK (
    status <> 'FAILED'
    OR (last_error IS NOT NULL AND btrim(last_error) <> '')
  )
);

CREATE INDEX governed_recovery_commands_queue_idx
  ON platform.governed_recovery_commands (
    tenant_id,
    status,
    requested_at,
    recovery_command_id
  )
  WHERE status = 'QUEUED';

CREATE INDEX governed_recovery_commands_target_idx
  ON platform.governed_recovery_commands (
    tenant_id,
    target_kind,
    target_id,
    requested_at DESC
  );

CREATE INDEX governed_recovery_commands_correlation_idx
  ON platform.governed_recovery_commands (
    tenant_id,
    correlation_id,
    requested_at DESC
  );

CREATE OR REPLACE FUNCTION platform.touch_governed_recovery_command_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER governed_recovery_commands_touch_updated_at
BEFORE UPDATE ON platform.governed_recovery_commands
FOR EACH ROW EXECUTE FUNCTION platform.touch_governed_recovery_command_updated_at();

CREATE TABLE platform.governed_recovery_command_events (
  recovery_command_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE RESTRICT,
  recovery_command_id uuid NOT NULL,
  event_type text NOT NULL CHECK (
    event_type IN (
      'COMMAND_REQUESTED',
      'COMMAND_CLAIMED',
      'COMMAND_SUCCEEDED',
      'COMMAND_FAILED',
      'COMMAND_REJECTED',
      'COMMAND_CANCELLED',
      'COMMAND_NOTE_ADDED'
    )
  ),
  previous_status text CHECK (
    previous_status IS NULL OR previous_status IN ('QUEUED', 'CLAIMED', 'SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELLED')
  ),
  new_status text NOT NULL CHECK (
    new_status IN ('QUEUED', 'CLAIMED', 'SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELLED')
  ),
  actor_subject_id text NOT NULL CHECK (btrim(actor_subject_id) <> ''),
  actor_role_key text NOT NULL CHECK (btrim(actor_role_key) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (recovery_command_id, tenant_id)
    REFERENCES platform.governed_recovery_commands(recovery_command_id, tenant_id)
    ON DELETE RESTRICT
);

CREATE INDEX governed_recovery_command_events_command_idx
  ON platform.governed_recovery_command_events (
    tenant_id,
    recovery_command_id,
    occurred_at DESC
  );

CREATE INDEX governed_recovery_command_events_type_idx
  ON platform.governed_recovery_command_events (
    tenant_id,
    event_type,
    occurred_at DESC
  );

CREATE OR REPLACE FUNCTION platform.reject_governed_recovery_command_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'governed recovery command events are append-only';
END;
$$;

CREATE TRIGGER governed_recovery_command_events_append_only
BEFORE UPDATE OR DELETE ON platform.governed_recovery_command_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_governed_recovery_command_event_mutation();

ALTER TABLE platform.governed_recovery_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.governed_recovery_commands FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.governed_recovery_command_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.governed_recovery_command_events FORCE ROW LEVEL SECURITY;

CREATE POLICY governed_recovery_commands_tenant_all
  ON platform.governed_recovery_commands
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY governed_recovery_command_events_tenant_select
  ON platform.governed_recovery_command_events
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY governed_recovery_command_events_tenant_insert
  ON platform.governed_recovery_command_events
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMENT ON TABLE platform.governed_recovery_commands IS
  'Tenant-scoped governed recovery command queue model. Rows represent authorized recovery intent only; execution is handled by later governed recovery processors.';

COMMENT ON TABLE platform.governed_recovery_command_events IS
  'Append-only evidence trail for governed recovery command lifecycle events.';

COMMIT;
