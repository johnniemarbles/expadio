\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name, vertical_key) VALUES
  ('97979797-9797-9797-9797-979797979797', 'Communication Health Tenant A', 'dentex'),
  ('98989898-9898-9898-9898-989898989898', 'Communication Health Tenant B', 'dentex');

SELECT set_config('app.tenant_id', '97979797-9797-9797-9797-979797979797', false);

INSERT INTO platform.communication_deliveries (
  delivery_id, tenant_id, idempotency_key, channel, connector_key,
  adapter_key, provider_message_id, state, attempt_count,
  requested_at, accepted_at, updated_at, last_reason_code
) VALUES
  (
    '97970000-0000-0000-0000-000000000001',
    '97979797-9797-9797-9797-979797979797',
    'communication-health-in-flight',
    'email',
    'resend-health-a',
    'resend-email-v1',
    'provider-health-in-flight',
    'ACCEPTED',
    1,
    '2026-08-30T15:00:00Z',
    '2026-08-30T15:00:01Z',
    '2026-08-30T15:00:02Z',
    'PROVIDER_ACCEPTED'
  ),
  (
    '97970000-0000-0000-0000-000000000002',
    '97979797-9797-9797-9797-979797979797',
    'communication-health-bounced',
    'email',
    'resend-health-a',
    'resend-email-v1',
    'provider-health-bounced',
    'BOUNCED',
    1,
    '2026-08-30T15:01:00Z',
    '2026-08-30T15:01:01Z',
    '2026-08-30T15:01:02Z',
    'PROVIDER_WEBHOOK_BOUNCED'
  ),
  (
    '97970000-0000-0000-0000-000000000003',
    '97979797-9797-9797-9797-979797979797',
    'communication-health-failed-attempt',
    'email',
    'resend-health-a',
    'resend-email-v1',
    NULL,
    'DELIVERED',
    1,
    '2026-08-30T15:02:00Z',
    '2026-08-30T15:02:01Z',
    '2026-08-30T15:02:02Z',
    'PROVIDER_ACCEPTED'
  );

INSERT INTO platform.communication_provider_attempts (
  provider_attempt_id, tenant_id, delivery_id, attempt_token,
  connector_key, provider_key, adapter_key, idempotency_key, outcome,
  provider_message_id, reason_code, reason, started_at, completed_at
) VALUES (
  '97970000-0000-0000-0000-000000000010',
  '97979797-9797-9797-9797-979797979797',
  '97970000-0000-0000-0000-000000000003',
  '97970000-0000-0000-0000-000000000011',
  'resend-health-a',
  'resend',
  'resend-email-v1',
  'communication-health-provider-attempt',
  'ERROR',
  NULL,
  'PROVIDER_ERROR',
  'Health smoke forced provider error',
  '2026-08-30T15:02:01Z',
  '2026-08-30T15:02:02Z'
);

INSERT INTO platform.communication_provider_webhook_events (
  webhook_event_id, tenant_id, provider_key, connector_key, provider_event_id,
  provider_message_id, event_type, normalized_outcome, delivery_id,
  previous_delivery_state, new_delivery_state, reason_code, payload,
  received_at, processed_at
) VALUES
  (
    '97970000-0000-0000-0000-000000000020',
    '97979797-9797-9797-9797-979797979797',
    'resend',
    'resend-health-a',
    'evt-health-unmatched-a',
    'provider-health-missing',
    'email.delivered',
    'UNMATCHED',
    NULL,
    NULL,
    NULL,
    'PROVIDER_WEBHOOK_UNMATCHED',
    '{"type":"email.delivered"}'::jsonb,
    '2026-08-30T15:03:00Z',
    '2026-08-30T15:03:01Z'
  ),
  (
    '97970000-0000-0000-0000-000000000021',
    '97979797-9797-9797-9797-979797979797',
    'resend',
    'resend-health-a',
    'evt-health-bounced-a',
    'provider-health-bounced',
    'email.bounced',
    'BOUNCED',
    '97970000-0000-0000-0000-000000000002',
    'DELIVERED',
    'BOUNCED',
    'PROVIDER_WEBHOOK_BOUNCED',
    '{"type":"email.bounced"}'::jsonb,
    '2026-08-30T15:04:00Z',
    '2026-08-30T15:04:01Z'
  );

SELECT set_config('app.tenant_id', '98989898-9898-9898-9898-989898989898', false);

INSERT INTO platform.communication_deliveries (
  delivery_id, tenant_id, idempotency_key, channel, connector_key,
  adapter_key, provider_message_id, state, attempt_count,
  requested_at, accepted_at, updated_at, last_reason_code
) VALUES (
  '98980000-0000-0000-0000-000000000001',
  '98989898-9898-9898-9898-989898989898',
  'communication-health-other-tenant',
  'email',
  'resend-health-b',
  'resend-email-v1',
  'provider-health-other-tenant',
  'ACCEPTED',
  1,
  '2026-08-30T15:00:00Z',
  '2026-08-30T15:00:01Z',
  '2026-08-30T15:00:02Z',
  'PROVIDER_ACCEPTED'
);

SELECT set_config('app.tenant_id', '97979797-9797-9797-9797-979797979797', false);

DO $$
DECLARE
  actual_keys text[];
  other_tenant_count integer;
BEGIN
  SELECT array_agg(health_key ORDER BY health_key)
    INTO actual_keys
    FROM platform.communication_health_summary;

  IF actual_keys IS DISTINCT FROM ARRAY[
    'communication_deliveries_in_flight',
    'communication_deliveries_negative_terminal',
    'communication_provider_attempt_failures',
    'communication_provider_webhooks_negative',
    'communication_provider_webhooks_unmatched'
  ]::text[] THEN
    RAISE EXCEPTION 'unexpected communication health keys: %', actual_keys;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM platform.communication_health_summary
     WHERE item_count <> 1
  ) THEN
    RAISE EXCEPTION 'expected one item per communication health key for tenant A';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM platform.communication_health_summary
     WHERE health_key = 'communication_deliveries_negative_terminal'
       AND health_status = 'DEGRADED'
       AND metadata -> 'states' ? 'BOUNCED'
  ) THEN
    RAISE EXCEPTION 'negative terminal communication health row did not expose BOUNCED state';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM platform.communication_health_summary
     WHERE health_key = 'communication_provider_attempt_failures'
       AND metadata -> 'outcomes' ? 'ERROR'
  ) THEN
    RAISE EXCEPTION 'provider attempt failure health row did not expose ERROR outcome';
  END IF;

  SELECT count(*)::integer
    INTO other_tenant_count
    FROM platform.communication_health_summary
   WHERE tenant_id = '98989898-9898-9898-9898-989898989898'::uuid;

  IF other_tenant_count <> 0 THEN
    RAISE EXCEPTION 'communication health view leaked another tenant: %', other_tenant_count;
  END IF;
END $$;

SELECT set_config('app.tenant_id', '98989898-9898-9898-9898-989898989898', false);

DO $$
DECLARE
  actual_keys text[];
BEGIN
  SELECT array_agg(health_key ORDER BY health_key)
    INTO actual_keys
    FROM platform.communication_health_summary;

  IF actual_keys IS DISTINCT FROM ARRAY['communication_deliveries_in_flight']::text[] THEN
    RAISE EXCEPTION 'unexpected tenant B communication health keys: %', actual_keys;
  END IF;
END $$;

-- The database contract job runs against an ephemeral database. Do not delete
-- provider attempts or webhook events here: both are append-only evidence.
RESET app.tenant_id;
