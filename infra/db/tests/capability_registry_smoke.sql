\set ON_ERROR_STOP on

INSERT INTO platform.capabilities (capability_key, display_name, permitted_modes)
VALUES ('email.delivery', 'Email Delivery', ARRAY['A','B']::text[]);

WITH capability AS (
  SELECT capability_id FROM platform.capabilities WHERE capability_key = 'email.delivery'
), connectors AS (
  INSERT INTO platform.connectors (
    connector_key, provider_type, provider_key, ownership_scope, tenant_id,
    region, residency_tags, compliance_tags, health, priority, enabled
  ) VALUES
    ('platform-email', 'email', 'provider-platform', 'PLATFORM', NULL,
      'ca-central', ARRAY['CA'], ARRAY['PIPEDA'], 'HEALTHY', 10, true),
    ('tenant-a-email', 'email', 'provider-a', 'TENANT', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'ca-central', ARRAY['CA'], ARRAY['PIPEDA'], 'HEALTHY', 20, true),
    ('tenant-b-email', 'email', 'provider-b', 'TENANT', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'ca-central', ARRAY['CA'], ARRAY['PIPEDA'], 'HEALTHY', 20, true)
  RETURNING connector_id
)
INSERT INTO platform.connector_capabilities (connector_id, capability_id)
SELECT connectors.connector_id, capability.capability_id
FROM connectors CROSS JOIN capability;

INSERT INTO platform.connector_credentials (connector_id, credential_ref)
SELECT connector_id, 'vault://providers/platform-email'
FROM platform.connectors WHERE connector_key = 'platform-email';

WITH capability AS (
  SELECT capability_id FROM platform.capabilities WHERE capability_key = 'email.delivery'
)
INSERT INTO platform.tenant_capability_bindings (
  tenant_id, capability_id, connector_id, mode, is_entitled, is_within_bounds
)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', capability.capability_id, connectors.connector_id, 'B', true, true
FROM capability
JOIN platform.connectors connectors ON connectors.connector_key = 'tenant-a-email'
UNION ALL
SELECT 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', capability.capability_id, connectors.connector_id, 'B', true, true
FROM capability
JOIN platform.connectors connectors ON connectors.connector_key = 'tenant-b-email';

INSERT INTO platform.capability_state (
  binding_id, tenant_id, state, input_hash, version, resolved_at
)
SELECT binding_id, tenant_id, 'ACTIVE', repeat('a', 64), 1, now()
FROM platform.tenant_capability_bindings;

INSERT INTO platform.capability_state_events (
  binding_id, tenant_id, from_state, to_state, input_hash
)
SELECT binding_id, tenant_id, NULL, 'ACTIVE', repeat('a', 64)
FROM platform.tenant_capability_bindings;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'connector_credentials'
      AND column_name IN ('encrypted_payload', 'secret', 'api_key', 'credential_payload')
  ) THEN
    RAISE EXCEPTION 'connector_credentials contains raw/encrypted credential payload columns';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'capability_state_events_append_only'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'append-only state event trigger missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'platform'
      AND c.relname = 'tenant_capability_bindings'
      AND c.relrowsecurity = true
      AND c.relforcerowsecurity = true
  ) THEN
    RAISE EXCEPTION 'tenant_capability_bindings RLS is not forced';
  END IF;
END;
$$;

DROP ROLE IF EXISTS expadio_app;
CREATE ROLE expadio_app NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_app;
GRANT SELECT ON platform.capabilities, platform.connectors, platform.connector_capabilities,
  platform.tenant_capability_bindings, platform.capability_proofs,
  platform.capability_state, platform.capability_state_events TO expadio_app;

SET ROLE expadio_app;
SELECT set_config('app.tenant_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);

DO $$
DECLARE
  connector_count integer;
  binding_count integer;
  state_count integer;
  event_count integer;
BEGIN
  SELECT count(*) INTO connector_count FROM platform.connectors;
  IF connector_count <> 2 THEN
    RAISE EXCEPTION 'tenant A expected 2 visible connectors (platform + own), got %', connector_count;
  END IF;

  SELECT count(*) INTO binding_count FROM platform.tenant_capability_bindings;
  IF binding_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected 1 binding, got %', binding_count;
  END IF;

  SELECT count(*) INTO state_count FROM platform.capability_state;
  IF state_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected 1 state row, got %', state_count;
  END IF;

  SELECT count(*) INTO event_count FROM platform.capability_state_events;
  IF event_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected 1 state event, got %', event_count;
  END IF;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    UPDATE platform.capability_state_events SET reason_key = 'mutated';
    RAISE EXCEPTION 'append-only mutation unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'append-only mutation unexpectedly succeeded' THEN
        RAISE;
      END IF;
      IF POSITION('append-only' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;
END;
$$;

SELECT 'capability registry smoke: ok' AS result;
