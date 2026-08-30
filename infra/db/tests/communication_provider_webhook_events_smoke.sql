\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('75111111-1111-1111-1111-111111111111', 'Provider Webhook Tenant A'),
  ('75222222-2222-2222-2222-222222222222', 'Provider Webhook Tenant B');

INSERT INTO platform.communication_deliveries (
  delivery_id, tenant_id, idempotency_key, channel,
  connector_key, adapter_key, provider_message_id, state,
  attempt_count, requested_at, accepted_at
) VALUES (
  '75110000-0000-0000-0000-000000000001',
  '75111111-1111-1111-1111-111111111111',
  'webhook-delivery-a', 'email', 'resend-primary', 'resend-email-v1',
  'resend-message-a', 'ACCEPTED', 1, now() - interval '5 minutes', now() - interval '4 minutes'
);

INSERT INTO platform.communication_provider_webhook_events (
  tenant_id, provider_key, connector_key, provider_event_id,
  provider_message_id, event_type, normalized_outcome,
  delivery_id, previous_delivery_state, new_delivery_state,
  reason_code, payload, received_at
) VALUES (
  '75111111-1111-1111-1111-111111111111',
  'resend', 'resend-primary', 'evt-delivered-a',
  'resend-message-a', 'email.delivered', 'DELIVERED',
  '75110000-0000-0000-0000-000000000001', 'ACCEPTED', 'DELIVERED',
  'PROVIDER_WEBHOOK_DELIVERED',
  '{"type":"email.delivered","data":{"email_id":"resend-message-a"}}'::jsonb,
  now()
);

INSERT INTO platform.communication_provider_webhook_events (
  tenant_id, provider_key, connector_key, provider_event_id,
  provider_message_id, event_type, normalized_outcome,
  delivery_id, previous_delivery_state, new_delivery_state,
  reason_code, payload, received_at
) VALUES (
  '75111111-1111-1111-1111-111111111111',
  'resend', 'resend-primary', 'evt-unmatched-a',
  'resend-message-missing', 'email.delivered', 'UNMATCHED',
  NULL, NULL, NULL,
  'PROVIDER_WEBHOOK_UNMATCHED',
  '{"type":"email.delivered","data":{"email_id":"resend-message-missing"}}'::jsonb,
  now()
);

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_provider_webhook_events (
      tenant_id, provider_key, connector_key, provider_event_id,
      provider_message_id, event_type, normalized_outcome,
      delivery_id, previous_delivery_state, new_delivery_state,
      reason_code, payload, received_at
    ) VALUES (
      '75111111-1111-1111-1111-111111111111',
      'resend', 'resend-primary', 'evt-delivered-a',
      'resend-message-a', 'email.delivered', 'DELIVERED',
      '75110000-0000-0000-0000-000000000001', 'ACCEPTED', 'DELIVERED',
      'PROVIDER_WEBHOOK_DELIVERED', '{}'::jsonb, now()
    );
    RAISE EXCEPTION 'duplicate provider webhook event unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE platform.communication_provider_webhook_events
       SET reason_code = 'MUTATED'
     WHERE tenant_id = '75111111-1111-1111-1111-111111111111'
       AND provider_event_id = 'evt-delivered-a';
    RAISE EXCEPTION 'provider webhook event mutation unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_provider_webhook_test;
CREATE ROLE expadio_provider_webhook_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_provider_webhook_test;
GRANT SELECT, INSERT ON platform.communication_provider_webhook_events TO expadio_provider_webhook_test;
GRANT SELECT ON platform.communication_deliveries TO expadio_provider_webhook_test;

SET ROLE expadio_provider_webhook_test;
SELECT set_config('app.tenant_id', '75111111-1111-1111-1111-111111111111', false);

DO $$
DECLARE visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count
    FROM platform.communication_provider_webhook_events;
  IF visible_count <> 2 THEN
    RAISE EXCEPTION 'tenant A expected two provider webhook events, got %', visible_count;
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_provider_webhook_events (
      tenant_id, provider_key, connector_key, provider_event_id,
      provider_message_id, event_type, normalized_outcome,
      reason_code, payload, received_at
    ) VALUES (
      '75222222-2222-2222-2222-222222222222',
      'resend', 'resend-primary', 'evt-cross-tenant',
      'resend-message-other', 'email.delivered', 'UNMATCHED',
      'PROVIDER_WEBHOOK_UNMATCHED', '{}'::jsonb, now()
    );
    RAISE EXCEPTION 'cross-tenant webhook insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

SELECT 'communication provider webhook events smoke: ok' AS result;
