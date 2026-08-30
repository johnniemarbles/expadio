BEGIN;

-- Durable execution metadata for the existing Communications delivery queue.
-- platform.communication_deliveries remains the authoritative queue.
ALTER TABLE platform.communication_deliveries
  ADD COLUMN dispatch_snapshot jsonb,
  ADD COLUMN claim_token uuid,
  ADD COLUMN claim_expires_at timestamptz,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN last_attempt_at timestamptz;

UPDATE platform.communication_deliveries
   SET next_attempt_at = requested_at
 WHERE next_attempt_at IS NULL;

ALTER TABLE platform.communication_deliveries
  ALTER COLUMN next_attempt_at SET NOT NULL;

ALTER TABLE platform.communication_deliveries
  ADD CONSTRAINT communication_deliveries_claim_pair_ck
  CHECK (
    (claim_token IS NULL AND claim_expires_at IS NULL)
    OR
    (claim_token IS NOT NULL AND claim_expires_at IS NOT NULL)
  ),
  ADD CONSTRAINT communication_deliveries_dispatch_snapshot_object_ck
  CHECK (
    dispatch_snapshot IS NULL
    OR jsonb_typeof(dispatch_snapshot) = 'object'
  );

CREATE INDEX communication_deliveries_pending_due_idx
  ON platform.communication_deliveries (
    tenant_id,
    next_attempt_at,
    requested_at,
    delivery_id
  )
  WHERE state = 'PENDING';

-- Existing rows predate durable dispatch snapshots and remain visible for
-- operations/recovery, but only newly snapshotted PENDING rows are executable.
COMMENT ON COLUMN platform.communication_deliveries.dispatch_snapshot IS
  'Immutable provider-neutral prepared dispatch plus send-time policy inputs. NULL only for legacy rows created before durable worker execution.';

CREATE OR REPLACE FUNCTION platform.reject_communication_delivery_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.dispatch_snapshot IS DISTINCT FROM NEW.dispatch_snapshot THEN
    RAISE EXCEPTION 'communication delivery dispatch snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER communication_delivery_dispatch_snapshot_immutable
BEFORE UPDATE OF dispatch_snapshot ON platform.communication_deliveries
FOR EACH ROW EXECUTE FUNCTION platform.reject_communication_delivery_snapshot_mutation();

ALTER TABLE platform.communication_delivery_events
  ADD COLUMN attempt_token uuid;

CREATE INDEX communication_delivery_events_attempt_idx
  ON platform.communication_delivery_events (
    tenant_id,
    delivery_id,
    attempt_token,
    occurred_at
  )
  WHERE attempt_token IS NOT NULL;

COMMIT;
