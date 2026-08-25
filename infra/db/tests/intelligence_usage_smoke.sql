\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('bf805162-c34d-4e75-f607-18293a4b5c6d', 'Usage Tenant A'),
  ('c0916273-d45e-4f86-0718-293a4b5c6d7e', 'Usage Tenant B');

INSERT INTO platform.organizations (
  organization_id, tenant_id, name
) VALUES
  (
    'd1a27384-e56f-4097-1829-3a4b5c6d7e8f',
    'bf805162-c34d-4e75-f607-18293a4b5c6d',
    'Usage Organization A'
  ),
  (
    'e2b38495-f670-41a8-293a-4b5c6d7e8f90',
    'c0916273-d45e-4f86-0718-293a4b5c6d7e',
    'Usage Organization B'
  );

INSERT INTO platform.intelligence_usage_events (
  event_id, tenant_id, organization_id, meter, quantity,
  cost_minor_units, currency, capability_key, connector_key,
  provider_key, model_key, provider_cost_ownership,
  work_reference, occurred_at, recorded_at,
  correlation_id, evidence_refs
) VALUES
  (
    'c0000000-0000-0000-0000-000000000001',
    'bf805162-c34d-4e75-f607-18293a4b5c6d',
    'd1a27384-e56f-4097-1829-3a4b5c6d7e8f',
    'AI_OUTPUT_TOKEN', 500, 30, 'USD',
    'ai.generate', 'tenant-llm', 'customer-provider', 'model-1',
    'BYOK', 'ai-job://job-a',
    '2026-08-25T21:00:00Z', now(),
    'c0000000-0000-0000-0000-000000000101',
    ARRAY['provider-response://request-a']
  ),
  (
    'c0000000-0000-0000-0000-000000000002',
    'c0916273-d45e-4f86-0718-293a4b5c6d7e',
    'e2b38495-f670-41a8-293a-4b5c6d7e8f90',
    'VOICE_MILLISECOND', 60000, 20, 'USD',
    'voice.transcribe', 'tenant-stt', 'customer-provider', 'stt-1',
    'CUSTOMER_PROVIDER', 'voice-job://job-b',
    '2026-08-25T21:00:00Z', now(),
    'c0000000-0000-0000-0000-000000000102',
    ARRAY['provider-response://request-b']
  );

DROP ROLE IF EXISTS expadio_usage_test;
CREATE ROLE expadio_usage_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_usage_test;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform.intelligence_usage_events
  TO expadio_usage_test;

SET ROLE expadio_usage_test;
SELECT set_config(
  'app.tenant_id',
  'bf805162-c34d-4e75-f607-18293a4b5c6d',
  false
);

DO $$
DECLARE
  event_count integer;
  cost_total bigint;
BEGIN
  SELECT count(*), sum(cost_minor_units)
    INTO event_count, cost_total
    FROM platform.intelligence_usage_events;
  IF event_count <> 1 OR cost_total <> 30 THEN
    RAISE EXCEPTION 'tenant A can see another tenant usage history';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.intelligence_usage_events (
      event_id, tenant_id, organization_id, meter, quantity,
      cost_minor_units, currency, capability_key, connector_key,
      provider_key, model_key, provider_cost_ownership,
      work_reference, occurred_at, recorded_at,
      correlation_id, evidence_refs
    ) VALUES (
      'c0000000-0000-0000-0000-000000000003',
      'c0916273-d45e-4f86-0718-293a4b5c6d7e',
      'e2b38495-f670-41a8-293a-4b5c6d7e8f90',
      'AI_REQUEST', 1, 1, 'USD',
      'ai.generate', 'cross-tenant', 'provider', NULL,
      'EXPADIO_MANAGED', 'ai-job://cross',
      now(), now(),
      'c0000000-0000-0000-0000-000000000103',
      ARRAY['negative:test']
    );
    RAISE EXCEPTION 'cross-tenant usage insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  changed_count integer;
BEGIN
  UPDATE platform.intelligence_usage_events
     SET cost_minor_units = 0
   WHERE event_id = 'c0000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'tenant usage mutation unexpectedly changed history';
  END IF;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    DELETE FROM platform.intelligence_usage_events
     WHERE event_id = 'c0000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'privileged usage deletion unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'Intelligence usage history is immutable%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

SELECT 'Intelligence usage smoke: ok' AS result;
