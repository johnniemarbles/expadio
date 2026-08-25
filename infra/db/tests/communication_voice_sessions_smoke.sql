\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('73737373-7373-7373-7373-737373737373', 'Voice Tenant A'),
  ('84848484-8484-8484-8484-848484848484', 'Voice Tenant B');

INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES
  ('73730000-0000-0000-0000-000000000001', '73737373-7373-7373-7373-737373737373', 'Voice Org A');

INSERT INTO platform.communication_conversations (
  conversation_id, tenant_id, organization_id, channel, owner_type
) VALUES (
  '73730000-0000-0000-0000-000000000002',
  '73737373-7373-7373-7373-737373737373',
  '73730000-0000-0000-0000-000000000001',
  'voice', 'SYSTEM'
);

INSERT INTO platform.communication_voice_sessions (
  call_id, tenant_id, organization_id, connector_key, provider_call_id,
  direction, from_address, to_address, state, requested_at, conversation_id
) VALUES (
  '73730000-0000-0000-0000-000000000003',
  '73737373-7373-7373-7373-737373737373',
  '73730000-0000-0000-0000-000000000001',
  'voice-primary', 'provider-call-a', 'OUTBOUND', '+15550000001', '+15550000002',
  'REQUESTED', now(), '73730000-0000-0000-0000-000000000002'
);

INSERT INTO platform.communication_voice_events (
  event_id, call_id, tenant_id, from_state, to_state, provider_event_id,
  provider_call_id, occurred_at
) VALUES (
  '73730000-0000-0000-0000-000000000004',
  '73730000-0000-0000-0000-000000000003',
  '73737373-7373-7373-7373-737373737373',
  'REQUESTED', 'RINGING', 'voice-event-a', 'provider-call-a', now()
);

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_voice_sessions (
      tenant_id, connector_key, provider_call_id, direction,
      from_address, to_address, state, requested_at
    ) VALUES (
      '73737373-7373-7373-7373-737373737373', 'voice-primary', 'provider-call-a',
      'OUTBOUND', '+15550000003', '+15550000004', 'REQUESTED', now()
    );
    RAISE EXCEPTION 'duplicate provider call identity unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE platform.communication_voice_events
       SET reason_code = 'MUTATED'
     WHERE event_id = '73730000-0000-0000-0000-000000000004';
    RAISE EXCEPTION 'voice event mutation unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_voice_test;
CREATE ROLE expadio_voice_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_voice_test;
GRANT SELECT, INSERT, UPDATE ON platform.communication_voice_sessions TO expadio_voice_test;
GRANT SELECT, INSERT ON platform.communication_voice_events TO expadio_voice_test;

SET ROLE expadio_voice_test;
SELECT set_config('app.tenant_id', '73737373-7373-7373-7373-737373737373', false);

DO $$
DECLARE visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM platform.communication_voice_sessions;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one voice session, got %', visible_count;
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_voice_sessions (
      tenant_id, connector_key, provider_call_id, direction,
      from_address, to_address, state, requested_at
    ) VALUES (
      '84848484-8484-8484-8484-848484848484', 'voice-forbidden', 'provider-call-b',
      'INBOUND', '+15550000005', '+15550000006', 'RINGING', now()
    );
    RAISE EXCEPTION 'cross-tenant voice write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

SELECT 'communication voice sessions smoke: ok' AS result;
