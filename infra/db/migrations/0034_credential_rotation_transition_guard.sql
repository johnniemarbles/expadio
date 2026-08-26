BEGIN;

CREATE OR REPLACE FUNCTION platform.enforce_credential_rotation_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prior platform.credential_rotation_events%ROWTYPE;
  transition_valid boolean;
BEGIN
  IF NEW.sequence = 1 THEN
    RETURN NEW;
  END IF;

  SELECT *
    INTO prior
    FROM platform.credential_rotation_events
   WHERE tenant_id = NEW.tenant_id
     AND rotation_reference = NEW.rotation_reference
     AND sequence = NEW.sequence - 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Credential rotation event sequence must be contiguous; missing %',
      NEW.sequence - 1;
  END IF;

  IF NEW.request_id IS DISTINCT FROM prior.request_id
     OR NEW.connector_key IS DISTINCT FROM prior.connector_key
     OR NEW.current_credential_reference
        IS DISTINCT FROM prior.current_credential_reference
     OR NEW.replacement_credential_reference
        IS DISTINCT FROM prior.replacement_credential_reference
  THEN
    RAISE EXCEPTION
      'Credential rotation event identity must remain stable';
  END IF;

  transition_valid :=
    (prior.event_type = 'STAGED' AND NEW.event_type = 'ACTIVATED')
    OR (prior.event_type = 'ACTIVATED' AND NEW.event_type = 'REVOKED');

  IF NOT transition_valid THEN
    RAISE EXCEPTION
      'Credential rotation transition % -> % is invalid',
      prior.event_type,
      NEW.event_type;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER credential_rotation_events_transition_guard
BEFORE INSERT ON platform.credential_rotation_events
FOR EACH ROW EXECUTE FUNCTION platform.enforce_credential_rotation_transition();

COMMIT;
