BEGIN;

CREATE TABLE platform.workflow_activation_lifecycle_events (
  event_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  instance_id uuid NOT NULL,
  activation_id uuid NOT NULL,
  from_state text NOT NULL CHECK (from_state IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  to_state text NOT NULL CHECK (to_state IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  action text NOT NULL CHECK (action IN ('SUSPEND', 'RESUME', 'REVOKE')),
  affected_rights_grant_ids uuid[] NOT NULL CHECK (
    cardinality(affected_rights_grant_ids) > 0
    AND array_position(affected_rights_grant_ids, NULL) IS NULL
  ),
  monitoring_trigger_key text NOT NULL CHECK (btrim(monitoring_trigger_key) <> ''),
  source_verification_id uuid,
  performed_by_subject_id text NOT NULL CHECK (btrim(performed_by_subject_id) <> ''),
  performed_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  evidence_refs text[] NOT NULL CHECK (
    cardinality(evidence_refs) > 0
    AND array_position(evidence_refs, NULL) IS NULL
  ),
  FOREIGN KEY (activation_id, tenant_id, instance_id)
    REFERENCES platform.workflow_activations(activation_id, tenant_id, instance_id)
    ON DELETE CASCADE,
  FOREIGN KEY (source_verification_id, tenant_id)
    REFERENCES platform.workflow_activation_verifications(verification_id, tenant_id),
  UNIQUE (event_id, tenant_id)
);

CREATE INDEX workflow_activation_lifecycle_events_history_idx
  ON platform.workflow_activation_lifecycle_events
    (tenant_id, activation_id, performed_at DESC, event_id DESC);

CREATE OR REPLACE FUNCTION platform.validate_workflow_activation_lifecycle_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  activation_grants uuid[];
  current_state text;
  verified_exists boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.tenant_id::text || ':' || NEW.activation_id::text, 0)
  );

  SELECT source_rights_grant_ids
    INTO activation_grants
    FROM platform.workflow_activations
   WHERE tenant_id = NEW.tenant_id
     AND activation_id = NEW.activation_id
     AND instance_id = NEW.instance_id;

  IF activation_grants IS NULL THEN
    RAISE EXCEPTION 'lifecycle event activation identity was not found'
      USING ERRCODE = '23503';
  END IF;

  IF NOT (NEW.affected_rights_grant_ids <@ activation_grants) THEN
    RAISE EXCEPTION 'lifecycle affected rights must belong to the activation'
      USING ERRCODE = '23514';
  END IF;

  SELECT lifecycle.to_state
    INTO current_state
    FROM platform.workflow_activation_lifecycle_events lifecycle
   WHERE lifecycle.tenant_id = NEW.tenant_id
     AND lifecycle.activation_id = NEW.activation_id
   ORDER BY lifecycle.performed_at DESC, lifecycle.event_id DESC
   LIMIT 1;

  IF current_state IS NULL THEN
    SELECT EXISTS (
      SELECT 1
        FROM platform.workflow_activation_verifications verification
       WHERE verification.tenant_id = NEW.tenant_id
         AND verification.activation_id = NEW.activation_id
         AND verification.instance_id = NEW.instance_id
         AND verification.state = 'VERIFIED'
    ) INTO verified_exists;

    IF NOT verified_exists THEN
      RAISE EXCEPTION 'lifecycle requires a verified activation'
        USING ERRCODE = '23514';
    END IF;
    current_state := 'ACTIVE';
  END IF;

  IF NEW.from_state <> current_state THEN
    RAISE EXCEPTION 'lifecycle expected state %, current state %',
      NEW.from_state, current_state
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (NEW.from_state = 'ACTIVE' AND NEW.action = 'SUSPEND' AND NEW.to_state = 'SUSPENDED')
    OR (NEW.from_state = 'ACTIVE' AND NEW.action = 'REVOKE' AND NEW.to_state = 'REVOKED')
    OR (NEW.from_state = 'SUSPENDED' AND NEW.action = 'RESUME' AND NEW.to_state = 'ACTIVE')
    OR (NEW.from_state = 'SUSPENDED' AND NEW.action = 'REVOKE' AND NEW.to_state = 'REVOKED')
  ) THEN
    RAISE EXCEPTION 'invalid lifecycle transition'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_activation_lifecycle_events_validate
BEFORE INSERT ON platform.workflow_activation_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION platform.validate_workflow_activation_lifecycle_event();

CREATE OR REPLACE FUNCTION platform.reject_workflow_activation_lifecycle_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'workflow activation lifecycle events are immutable';
END;
$$;

CREATE TRIGGER workflow_activation_lifecycle_events_immutable
BEFORE UPDATE OR DELETE ON platform.workflow_activation_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_workflow_activation_lifecycle_mutation();

ALTER TABLE platform.workflow_activation_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_activation_lifecycle_events FORCE ROW LEVEL SECURITY;

CREATE POLICY workflow_activation_lifecycle_events_select
  ON platform.workflow_activation_lifecycle_events
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY workflow_activation_lifecycle_events_insert
  ON platform.workflow_activation_lifecycle_events
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
