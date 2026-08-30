\set ON_ERROR_STOP on

BEGIN;

INSERT INTO platform.tenants (tenant_id, name, vertical_key) VALUES
  ('a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', 'Scheduler Health Tenant A', 'dentex'),
  ('b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8', 'Scheduler Health Tenant B', 'dentex');

SELECT set_config('app.tenant_id', 'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', false);

INSERT INTO platform.domain_event_scheduler_targets (
  tenant_id, execution_enabled, cadence_seconds, next_scheduled_at,
  last_selected_at, last_invocation_id, last_result, created_at, updated_at
) VALUES (
  'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
  true,
  300,
  '2026-08-30T14:00:00Z',
  '2026-08-30T13:55:00Z',
  'a7a70000-0000-0000-0000-000000000001',
  'SUCCEEDED',
  '2026-08-30T13:00:00Z',
  '2026-08-30T14:00:00Z'
);

INSERT INTO platform.domain_event_tenant_execution_runs (
  run_id, tenant_id, invocation_id, lease_token, status,
  requested_limit, processed, published, failed, dead, stale_claim,
  started_at, finished_at, duration_ms, error
) VALUES
  (
    'a7a70000-0000-0000-0000-000000000010',
    'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
    'a7a70000-0000-0000-0000-000000000011',
    'a7a70000-0000-0000-0000-000000000012',
    'RUNNING',
    25,
    0,
    0,
    0,
    0,
    0,
    '2026-08-30T14:05:00Z',
    NULL,
    NULL,
    NULL
  ),
  (
    'a7a70000-0000-0000-0000-000000000020',
    'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
    'a7a70000-0000-0000-0000-000000000021',
    'a7a70000-0000-0000-0000-000000000022',
    'FAILED',
    25,
    3,
    2,
    1,
    0,
    0,
    '2026-08-30T13:00:00Z',
    '2026-08-30T13:00:05Z',
    5000,
    'scheduler health smoke forced failure'
  );

INSERT INTO platform.domain_event_tenant_execution_state (
  tenant_id, enabled, next_scheduled_at, current_run_id, lease_token,
  lease_expires_at, last_started_at, last_finished_at, last_success_at,
  last_failure_at, last_error, updated_at
) VALUES (
  'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
  true,
  '2026-08-30T14:10:00Z',
  'a7a70000-0000-0000-0000-000000000010',
  'a7a70000-0000-0000-0000-000000000012',
  '2026-08-30T14:06:00Z',
  '2026-08-30T14:05:00Z',
  '2026-08-30T13:00:05Z',
  NULL,
  '2026-08-30T13:00:05Z',
  'scheduler health smoke forced failure',
  '2026-08-30T14:06:00Z'
);

INSERT INTO platform.domain_events (
  event_id, tenant_id, aggregate_type, aggregate_id, event_type,
  event_version, occurred_at, actor_subject_id, correlation_id,
  causation_id, pack_key, pack_version, payload, metadata
) VALUES (
  'a7a70000-0000-0000-0000-000000000030',
  'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
  'crm.case',
  'scheduler-health-treatment-1',
  'Treatment.Discharged',
  1,
  '2026-08-30T13:30:00Z',
  'scheduler-health-reviewer',
  'scheduler-health-correlation-1',
  'scheduler-health-causation-1',
  'dentex',
  1,
  '{"stage":"RESOLVED"}'::jsonb,
  '{"source":"scheduler_health_summary_smoke"}'::jsonb
);

INSERT INTO platform.governed_action_intents (
  action_intent_id, tenant_id, source_event_id, source_event_type,
  aggregate_type, aggregate_id, rule_key, executor_class, action_key,
  idempotency_key, correlation_id, causation_id, requested_by_subject_id,
  requested_at, configuration, policy_decision
) VALUES (
  'a7a70000-0000-0000-0000-000000000031',
  'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
  'a7a70000-0000-0000-0000-000000000030',
  'Treatment.Discharged',
  'crm.case',
  'scheduler-health-treatment-1',
  'scheduler.patient-follow-up.email',
  'SCHEDULE',
  'patient.follow_up.schedule',
  'scheduler-health:event:schedule',
  'scheduler-health-correlation-1',
  'a7a70000-0000-0000-0000-000000000030',
  'scheduler-health-reviewer',
  '2026-08-30T13:30:01Z',
  '{"delaySeconds":604800}'::jsonb,
  '{"allowed":true,"policyKeys":[],"evidenceRefs":["smoke"],"reasonCode":"ALLOWED","evaluatedAt":"2026-08-30T13:30:01.000Z"}'::jsonb
);

INSERT INTO platform.scheduled_governed_actions (
  scheduled_action_id, tenant_id, parent_action_intent_id, due_at,
  next_attempt_at, target_executor_class, target_action_key,
  target_configuration, target_idempotency_key, state,
  child_action_intent_id, attempt_count, last_attempt_at, last_reason_code
) VALUES (
  'a7a70000-0000-0000-0000-000000000032',
  'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
  'a7a70000-0000-0000-0000-000000000031',
  '2026-08-29T14:00:00Z',
  '2026-08-29T14:00:00Z',
  'COMMUNICATE',
  'patient.follow_up',
  '{"triggerKey":"patient.follow_up"}'::jsonb,
  'scheduler-health:event:scheduled:communicate',
  'PENDING',
  NULL,
  0,
  NULL,
  NULL
);

SELECT set_config('app.tenant_id', 'b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8', false);

INSERT INTO platform.domain_event_scheduler_targets (
  tenant_id, execution_enabled, cadence_seconds, next_scheduled_at,
  last_result, created_at, updated_at
) VALUES (
  'b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8',
  false,
  300,
  '2026-08-30T14:00:00Z',
  'SKIPPED_DISABLED',
  '2026-08-30T13:00:00Z',
  '2026-08-30T14:00:00Z'
);

SELECT set_config('app.tenant_id', 'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7', false);

DO $$
DECLARE
  actual_keys text[];
  other_tenant_count integer;
BEGIN
  SELECT array_agg(health_key ORDER BY health_key)
    INTO actual_keys
    FROM platform.scheduler_health_summary;

  IF actual_keys IS DISTINCT FROM ARRAY[
    'scheduler_execution_expired_leases',
    'scheduler_execution_failed_runs',
    'scheduler_scheduled_actions_due_unmaterialized',
    'scheduler_targets_due'
  ]::text[] THEN
    RAISE EXCEPTION 'unexpected scheduler health keys for tenant A: %', actual_keys;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM platform.scheduler_health_summary
     WHERE item_count <> 1
  ) THEN
    RAISE EXCEPTION 'expected one item per scheduler health key for tenant A';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM platform.scheduler_health_summary
     WHERE health_key = 'scheduler_execution_expired_leases'
       AND health_status = 'DEGRADED'
       AND metadata ->> 'sourceTable' = 'platform.domain_event_tenant_execution_state'
  ) THEN
    RAISE EXCEPTION 'expired lease scheduler health row missing or malformed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM platform.scheduler_health_summary
     WHERE health_key = 'scheduler_execution_failed_runs'
       AND metadata -> 'statuses' ? 'FAILED'
  ) THEN
    RAISE EXCEPTION 'failed run scheduler health row did not expose FAILED status';
  END IF;

  SELECT count(*)::integer
    INTO other_tenant_count
    FROM platform.scheduler_health_summary
   WHERE tenant_id = 'b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8'::uuid;

  IF other_tenant_count <> 0 THEN
    RAISE EXCEPTION 'scheduler health view leaked another tenant: %', other_tenant_count;
  END IF;
END $$;

SELECT set_config('app.tenant_id', 'b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8', false);

DO $$
DECLARE
  actual_keys text[];
BEGIN
  SELECT array_agg(health_key ORDER BY health_key)
    INTO actual_keys
    FROM platform.scheduler_health_summary;

  IF actual_keys IS DISTINCT FROM ARRAY['scheduler_targets_disabled']::text[] THEN
    RAISE EXCEPTION 'unexpected scheduler health keys for tenant B: %', actual_keys;
  END IF;
END $$;

RESET app.tenant_id;
ROLLBACK;
