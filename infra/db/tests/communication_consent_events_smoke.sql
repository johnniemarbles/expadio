\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('12121212-1212-1212-1212-121212121212', 'Consent Tenant A'),
  ('34343434-3434-3434-3434-343434343434', 'Consent Tenant B');

INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES
  ('12120000-0000-0000-0000-000000000001', '12121212-1212-1212-1212-121212121212', 'Consent Org A'),
  ('34340000-0000-0000-0000-000000000001', '34343434-3434-3434-3434-343434343434', 'Consent Org B');

INSERT INTO platform.communication_consent_events (
  consent_event_id, tenant_id, organization_id, subject_id, recipient_key,
  channel, purpose, event_type, source, policy_version, evidence_ref,
  effective_at
) VALUES
  (
    '12121111-1111-1111-1111-111111111111',
    '12121212-1212-1212-1212-121212121212',
    NULL,
    'subject-a',
    'person@example.com',
    'email',
    'marketing',
    'GRANTED',
    'FORM',
    'privacy-v3',
    'capture:consent-1',
    '2026-08-25T03:00:00Z'
  ),
  (
    '12122222-2222-2222-2222-222222222222',
    '12121212-1212-1212-1212-121212121212',
    '12120000-0000-0000-0000-000000000001',
    'subject-a',
    '+14165550100',
    'sms',
    'marketing',
    'GRANTED',
    'API',
    NULL,
    'api:consent-2',
    '2026-08-25T03:05:00Z'
  ),
  (
    '34343333-3333-3333-3333-333333333333',
    '34343434-3434-3434-3434-343434343434',
    '34340000-0000-0000-0000-000000000001',
    'subject-b',
    'other@example.com',
    'email',
    'marketing',
    'WITHDRAWN',
    'ADMIN',
    NULL,
    'admin:withdrawal-1',
    '2026-08-25T03:10:00Z'
  );

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_consent_events (
      tenant_id, organization_id, recipient_key, channel, purpose, event_type, source
    ) VALUES (
      '12121212-1212-1212-1212-121212121212',
      '34340000-0000-0000-0000-000000000001',
      'cross-tenant@example.com',
      'email',
      'marketing',
      'GRANTED',
      'ADMIN'
    );
    RAISE EXCEPTION 'cross-tenant consent organization unexpectedly succeeded';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE platform.communication_consent_events
       SET event_type = 'WITHDRAWN'
     WHERE consent_event_id = '12121111-1111-1111-1111-111111111111';
    RAISE EXCEPTION 'consent event mutation unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'consent event mutation unexpectedly succeeded' THEN
        RAISE;
      END IF;
      IF POSITION('append-only' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_consent_test;
CREATE ROLE expadio_consent_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_consent_test;
GRANT SELECT, INSERT ON platform.communication_consent_events TO expadio_consent_test;

SET ROLE expadio_consent_test;
SELECT set_config('app.tenant_id', '12121212-1212-1212-1212-121212121212', false);

DO $$
DECLARE
  visible_count integer;
  tenant_wide_count integer;
  org_specific_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM platform.communication_consent_events;
  SELECT count(*) INTO tenant_wide_count
    FROM platform.communication_consent_events
   WHERE organization_id IS NULL;
  SELECT count(*) INTO org_specific_count
    FROM platform.communication_consent_events
   WHERE organization_id = '12120000-0000-0000-0000-000000000001';

  IF visible_count <> 2 THEN
    RAISE EXCEPTION 'tenant A expected 2 visible consent events, got %', visible_count;
  END IF;
  IF tenant_wide_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected 1 tenant-wide consent event, got %', tenant_wide_count;
  END IF;
  IF org_specific_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected 1 organization consent event, got %', org_specific_count;
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_consent_events (
      tenant_id, organization_id, recipient_key, channel, purpose, event_type, source
    ) VALUES (
      '34343434-3434-3434-3434-343434343434',
      '34340000-0000-0000-0000-000000000001',
      'forbidden@example.com',
      'email',
      'marketing',
      'GRANTED',
      'FORM'
    );
    RAISE EXCEPTION 'cross-tenant consent RLS write unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

SELECT 'communication consent events smoke: ok' AS result;
