\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name, vertical_key) VALUES
  ('74747474-7474-7474-7474-747474747474', 'Execution Trace Tenant A', 'dentex'),
  ('85858585-8585-8585-8585-858585858585', 'Execution Trace Tenant B', 'dentex');

SELECT set_config('app.tenant_id', '74747474-7474-7474-7474-747474747474', false);

INSERT INTO platform.domain_events (
  event_id, tenant_id, aggregate_type, aggregate_id, event_type,
  event_version, occurred_at, actor_subject_id, correlation_id,
  causation_id, pack_key, pack_version, payload, metadata
) VALUES (
  '74740000-0000-0000-0000-000000000001',
  '74747474-7474-7474-7474-747474747474',
  'crm.case',
  'trace-treatment-1',
  'Treatment.Discharged',
  1,
  '2026-08-30T13:00:00Z',
  'trace-reviewer',
  'trace-correlation-1',
  'workflow-transition-1',
  'dentex',
  1,
  '{"stage":"RESOLVED"}'::jsonb,
  '{"source":"business_execution_trace_smoke"}'::jsonb
);

INSERT INTO platform.domain_event_outbox (
  outbox_id, tenant_id, event_id, topic, partition_key,
  status, attempts, available_at, claimed_at, published_at
) VALUES (
  '74740000-0000-0000-0000-000000000002',
  '74747474-7474-7474-7474-747474747474',
  '74740000-0000-0000-0000-000000000001',
  'domain.events',
  'crm.case:trace-treatment-1',
  'PUBLISHED',
  1,
  '2026-08-30T13:00:00Z',
  '2026-08-30T13:00:01Z',
  '2026-08-30T13:00:02Z'
);

INSERT INTO platform.governed_action_intents (
  action_intent_id, tenant_id, source_event_id, source_event_type,
  aggregate_type, aggregate_id, rule_key, executor_class, action_key,
  idempotency_key, correlation_id, causation_id, requested_by_subject_id,
  requested_at, configuration, policy_decision
) VALUES
  (
    '74740000-0000-0000-0000-000000000010',
    '74747474-7474-7474-7474-747474747474',
    '74740000-0000-0000-0000-000000000001',
    'Treatment.Discharged',
    'crm.case',
    'trace-treatment-1',
    'trace.patient-follow-up.schedule',
    'SCHEDULE',
    'patient.follow_up.schedule',
    'trace:event:schedule',
    'trace-correlation-1',
    '74740000-0000-0000-0000-000000000001',
    'trace-reviewer',
    '2026-08-30T13:00:01Z',
    '{"delaySeconds":604800,"target":{"executorClass":"COMMUNICATE","actionKey":"patient.follow_up","configuration":{"triggerKey":"patient.follow_up"}}}'::jsonb,
    '{"allowed":true,"policyKeys":[],"evidenceRefs":["smoke"],"reasonCode":"ALLOWED","evaluatedAt":"2026-08-30T13:00:01.000Z"}'::jsonb
  ),
  (
    '74740000-0000-0000-0000-000000000011',
    '74747474-7474-7474-7474-747474747474',
    '74740000-0000-0000-0000-000000000001',
    'Treatment.Discharged',
    'crm.case',
    'trace-treatment-1',
    'trace.patient-follow-up.email',
    'COMMUNICATE',
    'patient.follow_up',
    'trace:event:schedule:scheduled:COMMUNICATE:patient.follow_up',
    'trace-correlation-1',
    '74740000-0000-0000-0000-000000000020',
    'trace-reviewer',
    '2026-09-06T13:00:00Z',
    '{"triggerKey":"patient.follow_up"}'::jsonb,
    '{"allowed":true,"policyKeys":[],"evidenceRefs":["smoke"],"reasonCode":"ALLOWED","evaluatedAt":"2026-09-06T13:00:00.000Z"}'::jsonb
  ),
  (
    '74740000-0000-0000-0000-000000000012',
    '74747474-7474-7474-7474-747474747474',
    '74740000-0000-0000-0000-000000000001',
    'Treatment.Discharged',
    'crm.case',
    'trace-treatment-1',
    'trace.patient-follow-up.review-task',
    'CREATE_TASK',
    'patient.follow_up.review_task',
    'trace:event:create-task',
    'trace-correlation-1',
    '74740000-0000-0000-0000-000000000001',
    'trace-reviewer',
    '2026-08-30T13:00:01Z',
    '{"title":"Review discharged treatment follow-up","priority":"NORMAL"}'::jsonb,
    '{"allowed":true,"policyKeys":[],"evidenceRefs":["smoke"],"reasonCode":"ALLOWED","evaluatedAt":"2026-08-30T13:00:01.000Z"}'::jsonb
  );

INSERT INTO platform.governed_action_execution_attempts (
  execution_attempt_id, tenant_id, action_intent_id, executor_class,
  attempt_key, status, started_at, completed_at, reason_code,
  reason, output_reference, metadata
) VALUES
  (
    '74740000-0000-0000-0000-000000000013',
    '74747474-7474-7474-7474-747474747474',
    '74740000-0000-0000-0000-000000000010',
    'SCHEDULE',
    'schedule.enqueue',
    'QUEUED',
    '2026-08-30T13:00:02Z',
    '2026-08-30T13:00:02Z',
    'SCHEDULED_ACTION_QUEUED',
    NULL,
    'scheduled.action:74740000-0000-0000-0000-000000000020',
    '{}'::jsonb
  ),
  (
    '74740000-0000-0000-0000-000000000014',
    '74747474-7474-7474-7474-747474747474',
    '74740000-0000-0000-0000-000000000011',
    'COMMUNICATE',
    'communication.queue',
    'QUEUED',
    '2026-09-06T13:00:00Z',
    '2026-09-06T13:00:00Z',
    'COMMUNICATION_QUEUED',
    NULL,
    'communication.delivery:74740000-0000-0000-0000-000000000030',
    '{}'::jsonb
  ),
  (
    '74740000-0000-0000-0000-000000000015',
    '74747474-7474-7474-7474-747474747474',
    '74740000-0000-0000-0000-000000000012',
    'CREATE_TASK',
    'task.create',
    'SUCCEEDED',
    '2026-08-30T13:00:03Z',
    '2026-08-30T13:00:03Z',
    'TASK_CREATED',
    NULL,
    'operational.task:74740000-0000-0000-0000-000000000040',
    '{}'::jsonb
  );

INSERT INTO platform.scheduled_governed_actions (
  scheduled_action_id, tenant_id, parent_action_intent_id, due_at,
  next_attempt_at, target_executor_class, target_action_key,
  target_configuration, target_idempotency_key, state,
  child_action_intent_id, attempt_count, last_attempt_at, last_reason_code
) VALUES (
  '74740000-0000-0000-0000-000000000020',
  '74747474-7474-7474-7474-747474747474',
  '74740000-0000-0000-0000-000000000010',
  '2026-09-06T13:00:00Z',
  '2026-09-06T13:00:00Z',
  'COMMUNICATE',
  'patient.follow_up',
  '{"triggerKey":"patient.follow_up"}'::jsonb,
  'trace:event:schedule:scheduled:COMMUNICATE:patient.follow_up',
  'MATERIALIZED',
  '74740000-0000-0000-0000-000000000011',
  1,
  '2026-09-06T13:00:00Z',
  'CHILD_ACTION_MATERIALIZED'
);

INSERT INTO platform.communication_deliveries (
  delivery_id, tenant_id, idempotency_key, channel, connector_key,
  adapter_key, provider_message_id, state, attempt_count,
  requested_at, accepted_at, last_reason_code
) VALUES (
  '74740000-0000-0000-0000-000000000030',
  '74747474-7474-7474-7474-747474747474',
  'trace:event:schedule:scheduled:COMMUNICATE:patient.follow_up',
  'email',
  'resend-trace',
  'resend-email-v1',
  'provider-trace-message-1',
  'ACCEPTED',
  1,
  '2026-09-06T13:00:00Z',
  '2026-09-06T13:00:01Z',
  'PROVIDER_ACCEPTED'
);

INSERT INTO platform.communication_provider_attempts (
  provider_attempt_id, tenant_id, delivery_id, attempt_token,
  connector_key, provider_key, adapter_key, idempotency_key,
  outcome, provider_message_id, reason_code, reason,
  started_at, completed_at
) VALUES (
  '74740000-0000-0000-0000-000000000031',
  '74747474-7474-7474-7474-747474747474',
  '74740000-0000-0000-0000-000000000030',
  '74740000-0000-0000-0000-000000000032',
  'resend-trace',
  'resend',
  'resend-email-v1',
  'trace:event:schedule:scheduled:COMMUNICATE:patient.follow_up',
  'ACCEPTED',
  'provider-trace-message-1',
  'PROVIDER_ACCEPTED',
  NULL,
  '2026-09-06T13:00:00Z',
  '2026-09-06T13:00:01Z'
);

INSERT INTO platform.operational_tasks (
  task_id, tenant_id, source_action_intent_id, source_event_id,
  aggregate_type, aggregate_id, idempotency_key, title,
  assignee_subject_id, due_at, priority, status,
  correlation_id, created_by_subject_id
) VALUES (
  '74740000-0000-0000-0000-000000000040',
  '74747474-7474-7474-7474-747474747474',
  '74740000-0000-0000-0000-000000000012',
  '74740000-0000-0000-0000-000000000001',
  'crm.case',
  'trace-treatment-1',
  'trace:event:create-task',
  'Review discharged treatment follow-up',
  'trace-reviewer',
  '2026-08-31T13:00:00Z',
  'NORMAL',
  'OPEN',
  'trace-correlation-1',
  'trace-reviewer'
);

DO $$
DECLARE
  visible_count integer;
  parent_id text;
BEGIN
  SELECT count(*) INTO visible_count
    FROM platform.business_execution_trace
   WHERE root_event_id = '74740000-0000-0000-0000-000000000001';
  IF visible_count <> 12 THEN
    RAISE EXCEPTION 'expected 12 execution trace rows, got %', visible_count;
  END IF;

  SELECT count(*) INTO visible_count
    FROM platform.business_execution_trace
   WHERE root_event_id = '74740000-0000-0000-0000-000000000001'
     AND trace_kind = 'GOVERNED_ACTION';
  IF visible_count <> 3 THEN
    RAISE EXCEPTION 'expected 3 governed action trace rows, got %', visible_count;
  END IF;

  SELECT parent_trace_id INTO parent_id
    FROM platform.business_execution_trace
   WHERE trace_id = 'governed_action:74740000-0000-0000-0000-000000000011';
  IF parent_id <> 'scheduled_action:74740000-0000-0000-0000-000000000020' THEN
    RAISE EXCEPTION 'scheduled child action parent mismatch: %', parent_id;
  END IF;

  SELECT parent_trace_id INTO parent_id
    FROM platform.business_execution_trace
   WHERE trace_id = 'communication_delivery:74740000-0000-0000-0000-000000000030';
  IF parent_id <> 'governed_action:74740000-0000-0000-0000-000000000011' THEN
    RAISE EXCEPTION 'delivery parent mismatch: %', parent_id;
  END IF;

  SELECT parent_trace_id INTO parent_id
    FROM platform.business_execution_trace
   WHERE trace_id = 'communication_provider_attempt:74740000-0000-0000-0000-000000000031';
  IF parent_id <> 'communication_delivery:74740000-0000-0000-0000-000000000030' THEN
    RAISE EXCEPTION 'provider attempt parent mismatch: %', parent_id;
  END IF;

  SELECT parent_trace_id INTO parent_id
    FROM platform.business_execution_trace
   WHERE trace_id = 'operational_task:74740000-0000-0000-0000-000000000040';
  IF parent_id <> 'governed_action:74740000-0000-0000-0000-000000000012' THEN
    RAISE EXCEPTION 'task parent mismatch: %', parent_id;
  END IF;
END;
$$;

SELECT set_config('app.tenant_id', '85858585-8585-8585-8585-858585858585', false);

DO $$
DECLARE visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count
    FROM platform.business_execution_trace
   WHERE root_event_id = '74740000-0000-0000-0000-000000000001';
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'cross-tenant trace visibility leak: % rows visible', visible_count;
  END IF;
END;
$$;

SELECT 'business execution trace smoke: ok' AS result;
