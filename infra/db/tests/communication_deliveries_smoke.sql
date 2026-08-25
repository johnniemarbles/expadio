\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('31313131-3131-3131-3131-313131313131', 'Delivery Tenant A'),
  ('42424242-4242-4242-4242-424242424242', 'Delivery Tenant B');

INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES
  ('31310000-0000-0000-0000-000000000001', '31313131-3131-3131-3131-313131313131', 'Delivery Org A');

INSERT INTO platform.communication_deliveries (
  delivery_id, tenant_id, organization_id, idempotency_key, channel,
  connector_key, adapter_key, provider_message_id, state, attempt_count,
  requested_at, accepted_at
) VALUES (
  '51510000-0000-0000-0000-000000000001',
  '31313131-3131-3131-3131-313131313131',
  '31310000-0000-0000-0000-000000000001',
  'delivery-idem-a', 'email', 'email-primary', 'resend-runtime', 'provider-msg-a',
  'ACCEPTED', 1, now(), now()
);

INSERT INTO platform.communication_delivery_events (
  event_id, delivery_id, tenant_id, from_state, to_state, provider_event_id, occurred_at
) VALUES (
  '61610000-0000-0000-0000-000000000001',
  '51510000-0000-0000-0000-000000000001',
  '31313131-3131-3131-3131-313131313131',
  'PENDING', 'ACCEPTED', 'provider-event-a', now()
);

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_deliveries (
      tenant_id, idempotency_key, channel, connector_key, adapter_key, requested_at
    ) VALUES (
      '31313131-3131-3131-3131-313131313131', 'delivery-idem-a', 'email',
      'email-secondary', 'other-runtime', now()
    );
    RAISE EXCEPTION 'duplicate tenant idempotency key unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE platform.communication_delivery_events
       SET reason = 'mutated'
     WHERE event_id = '61610000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'delivery event mutation unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_delivery_test;
CREATE ROLE expadio_delivery_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_delivery_test;
GRANT SELECT, INSERT, UPDATE ON platform.communication_deliveries TO expadio_delivery_test;
GRANT SELECT, INSERT ON platform.communication_delivery_events TO expadio_delivery_test;

SET ROLE expadio_delivery_test;
SELECT set_config('app.tenant_id', '31313131-3131-3131-3131-313131313131', false);

DO $$
DECLARE visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM platform.communication_deliveries;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one delivery, got %', visible_count;
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_deliveries (
      tenant_id, idempotency_key, channel, connector_key, adapter_key, requested_at
    ) VALUES (
      '42424242-4242-4242-4242-424242424242', 'forbidden-delivery', 'sms',
      'sms-primary', 'twilio-runtime', now()
    );
    RAISE EXCEPTION 'cross-tenant delivery write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

SELECT 'communication deliveries smoke: ok' AS result;
