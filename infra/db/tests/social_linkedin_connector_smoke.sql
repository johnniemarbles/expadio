\set ON_ERROR_STOP on

-- Seed-tenant / catalog proof for Social Content dark wiring (0086).
-- Connector social.linkedin must exist, stay disabled, and bind
-- communication.social.send. Social is a subject channel, not a sender identity.

DO $$
DECLARE
  cap_enabled boolean;
  cap_modes text[];
  conn record;
  binding_count integer;
  deliveries_def text;
  sender_def text;
BEGIN
  SELECT enabled, permitted_modes
    INTO cap_enabled, cap_modes
    FROM platform.capabilities
   WHERE capability_key = 'communication.social.send';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'capability communication.social.send is not seeded';
  END IF;
  IF cap_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'capability communication.social.send must stay enabled as a vocabulary row';
  END IF;
  IF cap_modes IS NULL OR NOT ('A' = ANY (cap_modes)) THEN
    RAISE EXCEPTION 'capability communication.social.send permitted_modes missing A';
  END IF;

  SELECT connector_key, provider_type, provider_key, ownership_scope, tenant_id,
         health, priority, enabled, fallback_enabled
    INTO conn
    FROM platform.connectors
   WHERE connector_key = 'social.linkedin';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'connector social.linkedin is not seeded';
  END IF;
  IF conn.provider_type IS DISTINCT FROM 'social'
     OR conn.provider_key IS DISTINCT FROM 'linkedin' THEN
    RAISE EXCEPTION 'social.linkedin provider binding is wrong: % / %', conn.provider_type, conn.provider_key;
  END IF;
  IF conn.ownership_scope IS DISTINCT FROM 'PLATFORM' OR conn.tenant_id IS NOT NULL THEN
    RAISE EXCEPTION 'social.linkedin must be PLATFORM with tenant_id NULL';
  END IF;
  IF conn.enabled IS NOT FALSE THEN
    RAISE EXCEPTION 'social.linkedin must stay enabled=false until BYOC + lease';
  END IF;
  IF conn.fallback_enabled IS NOT FALSE THEN
    RAISE EXCEPTION 'social.linkedin must not be a fallback connector';
  END IF;
  IF conn.priority IS DISTINCT FROM 200 THEN
    RAISE EXCEPTION 'social.linkedin priority expected 200, got %', conn.priority;
  END IF;

  SELECT count(*) INTO binding_count
    FROM platform.connector_capabilities cc
    JOIN platform.connectors c ON c.connector_id = cc.connector_id
    JOIN platform.capabilities cap ON cap.capability_id = cc.capability_id
   WHERE c.connector_key = 'social.linkedin'
     AND cap.capability_key = 'communication.social.send';
  IF binding_count <> 1 THEN
    RAISE EXCEPTION 'social.linkedin must bind communication.social.send exactly once, got %', binding_count;
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO deliveries_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'platform'
     AND t.relname = 'communication_deliveries'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%channel IN (%'
     AND pg_get_constraintdef(c.oid) LIKE '%''email''%'
   LIMIT 1;
  IF deliveries_def IS NULL OR deliveries_def NOT LIKE '%''social''%' THEN
    RAISE EXCEPTION 'communication_deliveries channel CHECK missing social: %', deliveries_def;
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO sender_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'platform'
     AND t.relname = 'communication_sender_identities'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%channel IN (%'
   LIMIT 1;
  IF sender_def IS NULL THEN
    RAISE EXCEPTION 'communication_sender_identities channel CHECK missing';
  END IF;
  IF sender_def LIKE '%''social''%' THEN
    RAISE EXCEPTION 'sender-identity CHECK must not include social: %', sender_def;
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_sender_identities (
      scope, channel, address, purposes
    ) VALUES (
      'PLATFORM', 'social', 'urn:li:person:seed-proof', ARRAY['marketing']::text[]
    );
    RAISE EXCEPTION 'social sender identity unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM = 'social sender identity unexpectedly succeeded' THEN
        RAISE;
      END IF;
      RAISE;
  END;
END;
$$;

SELECT 'social linkedin connector smoke: ok' AS result;
