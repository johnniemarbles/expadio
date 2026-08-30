\set ON_ERROR_STOP on

BEGIN;

INSERT INTO platform.tenants (tenant_id, name, vertical_key) VALUES
  ('c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9', 'Outbox Health Tenant A', 'dentex'),
  ('d9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9', 'Outbox Health Tenant B', 'dentex');

SELECT set_config('app.tenant_id', 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9', false);

INSERT INTO platform.domain_events (
  event_id, tenant_id, aggregate_type, aggregate_id, event_type,
  event_version, occurred_at, actor_subject_id, correlation_id,
  causation_id, pack_key, pack_version, payload, metadata
) VALUES
  (
    'c9c90000-0000-0000-0000-000000000001',
    'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
    'crm.case',
    'outbox-health-ready',
    'Treatment.Discharged',
    1,
    '2026-08-29T10:00:00Z',
    'outbox-health-reviewer',
    'outbox-health-correlation-ready',
    'outbox-health-causation-ready',
    'dentex',
    1,
    '{"stage":"RESOLVED"}'::jsonb,
    '{"source":"outbox_health_summary_smoke"}'::jsonb
  ),
  (
    'c9c90000-0000-0000-0000-000000000002',
    'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
    'crm.case',
    'outbox-health-retry-due',
    'Treatment.Discharged',
    1,
    '2026-08-29T10:01:00Z',
    'outbox-health-reviewer',
    'outbox-health-correlation-retry-due',
    'outbox-health-causation-retry-due',
    'dentex',
    1,
    '{"stage":"RESOLVED"}'::jsonb,
    '{"source":"outbox_health_summary_smoke"}'::jsonb
  ),
  (
    'c9c90000-0000-0000-0000-000000000003',
    'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
    'crm.case',
    'outbox-health-future-retry',
    'Treatment.Discharged',
    1,
    '2026-08-29T10:02:00Z',
    'outbox-health-reviewer',
    'outbox-health-correlation-future-retry',
    'outbox-health-causation-future-retry',
    'dentex',
    1,
    '{"stage":"RESOLVED"}'::jsonb,
    '{"source":"outbox_health_summary_smoke"}'::jsonb
  ),
  (
    'c9c90000-0000-0000-0000-000000000004',
    'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
    'crm.case',
    'outbox-health-stale-claim',
    'Treatment.Discharged',
    1,
    '2026-08-29T10:03:00Z',
    'outbox-health-reviewer',
    'outbox-health-correlation-stale-claim',
    'outbox-health-causation-stale-claim',
    'dentex',
    1,
    '{"stage":"RESOLVED"}'::jsonb,
    '{"source":"outbox_health_summary_smoke"}'::jsonb
  ),
  (
    'c9c90000-0000-0000-0000-000000000005',
    'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
    'crm.case',
    'outbox-health-dead',
    'Treatment.Discharged',
    1,
    '2026-08-29T10:04:00Z',
    'outbox-health-reviewer',
    'outbox-health-correlation-dead',
    'outbox-health-causation-dead',
    'dentex',
    1,
    '{"stage":"RESOLVED"}'::jsonb,
    '{"source":"outbox_health_summary_smoke"}'::jsonb
  );

INSERT INTO platform.domain_event_outbox (
  outbox_id, tenant_id, event_id, topic, partition_key, status,
  attempts, available_at, claimed_at, published_at, last_error,
  created_at, updated_at
) VALUES
  (
    'c9c90000-0000-0000-0000-000000000101',
    'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
    'c9c90000-0000-0000-0000-000000000001',
    'domain.events',
    'outbox-health-ready',
    'PENDING',
    0,
    '2026-08-29T10:00:00Z',
    NULL,
    NULL,
    NULL,
    '2026-08-29T10:00:00Z',
    '2026-08-29T10:00:00Z'
  ),
  (
    'c9c90000-0000-0000-0000-000000000102',
    'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
    'c9c90000-0000-0000-0000-000000000002',
    'domain.events',
    'outbox-health-retry-due',
    'FAILED',
    2,
    '2026-08-29T10:01:00Z',
    NULL,
    NULL,
    'forced retry due',
    '2026-08-29T10:01:00Z',
    '2026-08-29T10:01:00Z'
  ),
  (
    'c9c90000-0000-0000-0000-000000000103',
    'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
    'c9c90000-0000-0000-0000-000000000003',
    'domain.events',
    'outbox-health-future-retry',
    'FAILED',
    3,
    '2026-09-30T10:02:00Z',
    NULL,
    NULL,
    'forced future retry',
    '2026-08-29T10:02:00Z',
    '2026-08-29T10:02:00Z'
  ),
  (
    'c9c90000-0000-0000-0000-000000000104',
    'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
    'c9c90000-0000-0000-0000-000000000004',
    'domain.events',
    'outbox-health-stale-claim',
    'CLAIMED',
    1,
    '2026-08-29T10:03:00Z',
    '2026-08-29T10:03:00Z',
    NULL,
    NULL,
    '2026-08-29T10:03:00Z',
    '2026-08-29T10:03:00Z'
  ),
  (
    'c9c90000-0000-0000-0000-000000000105',
    'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
    'c9c90000-0000-0000-0000-000000000005',
    'domain.events',
    'outbox-health-dead',
    'DEAD',
    5,
    '2026-08-29T10:04:00Z',
    NULL,
    NULL,
    'forced dead row',
    '2026-08-29T10:04:00Z',
    '2026-08-29T10:04:00Z'
  );

SELECT set_config('app.tenant_id', 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9', false);

INSERT INTO platform.domain_events (
  event_id, tenant_id, aggregate_type, aggregate_id, event_type,
  event_version, occurred_at, actor_subject_id, correlation_id,
  causation_id, pack_key, pack_version, payload, metadata
) VALUES (
  'd9d90000-0000-0000-0000-000000000001',
  'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9',
  'crm.case',
  'outbox-health-other-tenant',
  'Treatment.Discharged',
  1,
  '2026-08-29T11:00:00Z',
  'outbox-health-reviewer',
  'outbox-health-correlation-other',
  'outbox-health-causation-other',
  'dentex',
  1,
  '{"stage":"RESOLVED"}'::jsonb,
  '{"source":"outbox_health_summary_smoke"}'::jsonb
);

INSERT INTO platform.domain_event_outbox (
  outbox_id, tenant_id, event_id, topic, partition_key, status,
  attempts, available_at, created_at, updated_at
) VALUES (
  'd9d90000-0000-0000-0000-000000000101',
  'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9',
  'd9d90000-0000-0000-0000-000000000001',
  'domain.events',
  'outbox-health-other-tenant',
  'PENDING',
  0,
  '2026-08-29T11:00:00Z',
  '2026-08-29T11:00:00Z',
  '2026-08-29T11:00:00Z'
);

SELECT set_config('app.tenant_id', 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9', false);

DO $$
DECLARE
  actual_keys text[];
  other_tenant_count integer;
BEGIN
  SELECT array_agg(health_key ORDER BY health_key)
    INTO actual_keys
    FROM platform.outbox_health_summary;

  IF actual_keys IS DISTINCT FROM ARRAY[
    'domain_event_outbox_dead',
    'domain_event_outbox_future_retry',
    'domain_event_outbox_ready_backlog',
    'domain_event_outbox_retry_due',
    'domain_event_outbox_stale_claims'
  ]::text[] THEN
    RAISE EXCEPTION 'unexpected outbox health keys for tenant A: %', actual_keys;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM platform.outbox_health_summary
     WHERE item_count <> 1
  ) THEN
    RAISE EXCEPTION 'expected one item per outbox health key for tenant A';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM platform.outbox_health_summary
     WHERE health_key = 'domain_event_outbox_dead'
       AND health_status = 'DEGRADED'
       AND metadata -> 'attempts' ? '5'
  ) THEN
    RAISE EXCEPTION 'dead outbox health row missing DEAD attempt metadata';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM platform.outbox_health_summary
     WHERE health_key = 'domain_event_outbox_stale_claims'
       AND health_status = 'DEGRADED'
       AND metadata ->> 'sourceTable' = 'platform.domain_event_outbox'
  ) THEN
    RAISE EXCEPTION 'stale claim outbox health row missing or malformed';
  END IF;

  SELECT count(*)::integer
    INTO other_tenant_count
    FROM platform.outbox_health_summary
   WHERE tenant_id = 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9'::uuid;

  IF other_tenant_count <> 0 THEN
    RAISE EXCEPTION 'outbox health view leaked another tenant: %', other_tenant_count;
  END IF;
END $$;

SELECT set_config('app.tenant_id', 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9', false);

DO $$
DECLARE
  actual_keys text[];
BEGIN
  SELECT array_agg(health_key ORDER BY health_key)
    INTO actual_keys
    FROM platform.outbox_health_summary;

  IF actual_keys IS DISTINCT FROM ARRAY['domain_event_outbox_ready_backlog']::text[] THEN
    RAISE EXCEPTION 'unexpected outbox health keys for tenant B: %', actual_keys;
  END IF;
END $$;

RESET app.tenant_id;
ROLLBACK;
