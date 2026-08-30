\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name, vertical_key) VALUES
  ('76767676-7676-7676-7676-767676767676', 'Execution Health Tenant A', 'dentex'),
  ('87878787-8787-8787-8787-878787878787', 'Execution Health Tenant B', 'dentex');

SELECT set_config('app.tenant_id', '76767676-7676-7676-7676-767676767676', false);

INSERT INTO platform.domain_events (
  event_id, tenant_id, aggregate_type, aggregate_id, event_type,
  event_version, occurred_at, actor_subject_id, correlation_id,
  causation_id, pack_key, pack_version, payload, metadata
) VALUES (
  '76760000-0000-0000-0000-000000000001',
  '76767676-7676-7676-7676-767676767676',
  'crm.case',
  'health-treatment-1',
  'Treatment.Discharged',
  1,
  '2026-08-30T14:00:00Z',
  'health-reviewer',
  'health-correlation-1',
  'workflow-transition-health-1',
  'dentex',
  1,
  '{"stage":"RESOLVED"}'::jsonb,
  '{"source":"execution_health_summary_smoke"}'::jsonb
);

INSERT INTO platform.domain_event_outbox (
  outbox_id, tenant_id, event_id, topic, partition_key,
  status, attempts, available_at, claimed_at, published_at
) VALUES (
  '76760000-0000-0000-0000-000000000002',
  '76767676-7676-7676-7676-767676767676',
  '76760000-0000-0000-0000-000000000001',
  'domain.events',
  'crm.case:health-treatment-1',
  'FAILED',
  3,
  '2026-08-30T14:00:00Z',
  '2026-08-30T14:00:01Z',
  NULL
);

INSERT INTO platform.governed_action_intents (
  action_intent_id, tenant_id, source_event_id, source_event_type,
  aggregate_type, aggregate_id, rule_key, executor_class, action_key,
  idempotency_key, correlation_id, causation_id, requested_by_subject_id,
  requested_at, configuration, policy_decision
) VALUES (
  '76760000-0000-0000-0000-000000000010',
  '76767676-7676-7676-7676-767676767676',
  '76760000-0000-0000-0000-000000000001',
  'Treatment.Discharged',
  'crm.case',
  'health-treatment-1',
  'health.patient-follow-up.email',
  'COMMUNICATE',
  'patient.follow_up',
  'health:event:communicate',
  'health-correlation-1',
  '76760000-0000-0000-0000-000000000001',
  'health-reviewer',
  '2026-08-30T14:00:01Z',
  '{"triggerKey":"patient.follow_up"}'::jsonb,
  '{"allowed":true,"policyKeys":[],"evidenceRefs":["smoke"],"reasonCode":"ALLOWED","evaluatedAt":"2026-08-30T14:00:01.000Z"}'::jsonb
);

INSERT INTO platform.governed_action_execution_attempts (
  execution_attempt_id, tenant_id, action_intent_id, executor_class,
  attempt_key, status, started_at, completed_at, reason_code,
  reason, output_reference, metadata
) VALUES (
  '76760000-0000-0000-0000-000000000011',
  '76767676-7676-7676-7676-767676767676',
  '76760000-0000-0000-0000-000000000010',
  'COMMUNICATE',
  'communication.queue',
  'FAILED',
  '2026-08-30T14:00:02Z',
  '2026-08-30T14:00:03Z',
  'COMMUNICATION_QUEUE_FAILED',
  'Health smoke forced failure',
  NULL,
  '{}'::jsonb
);

INSERT INTO platform.scheduled_governed_actions (
  scheduled_action_id, tenant_id, parent_action_intent_id, due_at,
  next_attempt_at, target_executor_class, target_action_key,
  target_configuration, target_idempotency_key, state,
  child_action_intent_id, attempt_count, last_attempt_at, last_reason_code
) VALUES (
  '76760000-0000-0000-0000-000000000020',
  '76767676-7676-7676-7676-767676767676',
  '76760000-0000-0000-0000-000000000010',
  '2026-08-29T14:00:00Z',
  '2026-08-29T14:00:00Z',
  'COMMUNICATE',
  'patient.follow_up',
  '{"triggerKey":"patient.follow_up"}'::jsonb,
  'health:event:scheduled:communicate',
  'PENDING',
  NULL,
  0,
  NULL,
  NULL
);

INSERT INTO platform.communication_deliveries (
  delivery_id, tenant_id, idempotency_key, channel, connector_key,
  adapter_key, provider_message_id, state, attempt_count,
  requested_at, accepted_at, last_reason_code
) VALUES (
  '76760000-0000-0000-0000-000000000030',
  '76767676-7676-7676-7676-767676767676',
  'health:event:communicate',
  'email',
  'resend-health',
  'resend-email-v1',
  'provider-health-message-1',
  'ACCEPTED',
  1,
  '2026-08-30T14:00:04Z',
  '2026-08-30T14:00:05Z',
  'PROVIDER_ACCEPTED'
);

INSERT INTO platform.communication_provider_webhook_events (
  webhook_event_id, tenant_id, provider_key, connector_key, provider_event_id,
  provider_message_id, event_type, normalized_outcome, delivery_id,
  previous_delivery_state, new_delivery_state, reason_code, payload,
  received_at, processed_at
) VALUES (
  '76760000-0000-0000-0000-000000000040',
  '76767676-7676-7676-7676-767676767676',
  'resend',
  'resend-health',
  'evt-health-unmatched',
  'provider-health-missing',
  'email.delivered',
  'UNMATCHED',
  NULL,
  NULL,
  NULL,
  'PROVIDER_WEBHOOK_UNMATCHED',
  '{"type":"email.delivered"}'::jsonb,
  '2026-08-30T14:00:06Z',
  '2026-08-30T14:00:07Z'
);

SELECT set_config('app.tenant_id', '87878787-8787-8787-8787-878787878787', false);

INSERT INTO platform.domain_events (
  event_id, tenant_id, aggregate_type, aggregate_id, event_type,
  event_version, occurred_at, actor_subject_id, correlation_id,
  causation_id, pack_key, pack_version, payload, metadata
) VALUES (
  '87870000-0000-0000-0000-000000000001',
  '87878787-8787-8787-8787-878787878787',
  'crm.case',
  'health-treatment-other-tenant',
  'Treatment.Discharged',
  1,
  '2026-08-30T14:00:00Z',
  'health-reviewer',
  'health-correlation-other',
  'workflow-transition-health-other',
  'dentex',
  1,
  '{}'::jsonb,
  '{}'::jsonb
);

INSERT INTO platform.domain_event_outbox (
  outbox_id, tenant_id, event_id, topic, partition_key,
  status, attempts, available_at, claimed_at, published_at
) VALUES (
  '87870000-0000-0000-0000-000000000002',
  '87878787-8787-8787-8787-878787878787',
  '87870000-0000-0000-0000-000000000001',
  'domain.events',
  'crm.case:health-treatment-other-tenant',
  'FAILED',
  1,
  '2026-08-30T14:00:00Z',
  NULL,
  NULL
);

SELECT set_config('app.tenant_id', '76767676-7676-7676-7676-767676767676', false);

DO $$
DECLARE
  actual_keys text[];
  other_tenant_count integer;
BEGIN
  SELECT array_agg(health_key ORDER BY health_key)
    INTO actual_keys
    FROM platform.execution_health_summary;

  IF actual_keys IS DISTINCT FROM ARRAY[
    'communication_deliveries_open',
    'communication_provider_webhooks_unmatched',
    'domain_event_outbox_unpublished',
    'governed_action_failed_attempts',
    'scheduled_actions_due_unmaterialized'
  ]::text[] THEN
    RAISE EXCEPTION 'unexpected execution health keys: %', actual_keys;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM platform.execution_health_summary
     WHERE item_count <> 1
  ) THEN
    RAISE EXCEPTION 'expected one item per execution health key for tenant A';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM platform.execution_health_summary
     WHERE health_key = 'domain_event_outbox_unpublished'
       AND health_status = 'DEGRADED'
       AND metadata -> 'statuses' ? 'FAILED'
  ) THEN
    RAISE EXCEPTION 'domain event outbox health row did not expose failed status';
  END IF;

  SELECT count(*)::integer
    INTO other_tenant_count
    FROM platform.execution_health_summary
   WHERE tenant_id = '87878787-8787-8787-8787-878787878787'::uuid;

  IF other_tenant_count <> 0 THEN
    RAISE EXCEPTION 'execution health view leaked another tenant: %', other_tenant_count;
  END IF;
END $$;

SELECT set_config('app.tenant_id', '87878787-8787-8787-8787-878787878787', false);

DO $$
DECLARE
  actual_keys text[];
BEGIN
  SELECT array_agg(health_key ORDER BY health_key)
    INTO actual_keys
    FROM platform.execution_health_summary;

  IF actual_keys IS DISTINCT FROM ARRAY['domain_event_outbox_unpublished']::text[] THEN
    RAISE EXCEPTION 'unexpected tenant B execution health keys: %', actual_keys;
  END IF;
END $$;

SELECT set_config('app.tenant_id', '76767676-7676-7676-7676-767676767676', false);
DELETE FROM platform.tenants WHERE tenant_id IN (
  '76767676-7676-7676-7676-767676767676',
  '87878787-8787-8787-8787-878787878787'
);
RESET app.tenant_id;
