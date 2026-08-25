\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('61616161-6161-6161-6161-616161616161', 'Sender Tenant A'),
  ('72727272-7272-7272-7272-727272727272', 'Sender Tenant B');

INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES
  ('61610000-0000-0000-0000-000000000001', '61616161-6161-6161-6161-616161616161', 'Sender Org A'),
  ('72720000-0000-0000-0000-000000000001', '72727272-7272-7272-7272-727272727272', 'Sender Org B');

INSERT INTO platform.communication_sender_identities (
  sender_id, scope, tenant_id, organization_id, channel, address, display_name,
  purposes, is_default, is_system_fallback, verification_status, status
) VALUES
  (
    '81810000-0000-0000-0000-000000000001',
    'PLATFORM', NULL, NULL, 'email', 'noreply@expadio.test', 'EXPADIO',
    ARRAY['transactional','system']::text[], true, true, 'VERIFIED', 'ACTIVE'
  ),
  (
    '81810000-0000-0000-0000-000000000002',
    'TENANT', '61616161-6161-6161-6161-616161616161', NULL,
    'email', 'hello@tenant-a.test', 'Tenant A', ARRAY['marketing','transactional']::text[],
    true, false, 'VERIFIED', 'ACTIVE'
  ),
  (
    '81810000-0000-0000-0000-000000000003',
    'ORGANIZATION', '61616161-6161-6161-6161-616161616161',
    '61610000-0000-0000-0000-000000000001', 'sms', '+15550000001', NULL,
    ARRAY['transactional']::text[], true, false, 'VERIFIED', 'ACTIVE'
  ),
  (
    '81810000-0000-0000-0000-000000000004',
    'TENANT', '72727272-7272-7272-7272-727272727272', NULL,
    'email', 'hello@tenant-b.test', 'Tenant B', ARRAY['marketing']::text[],
    true, false, 'VERIFIED', 'ACTIVE'
  );

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_sender_identities (
      scope, tenant_id, channel, address, purposes
    ) VALUES (
      'PLATFORM', '61616161-6161-6161-6161-616161616161',
      'email', 'invalid@expadio.test', ARRAY['system']::text[]
    );
    RAISE EXCEPTION 'invalid platform sender scope unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_sender_identities (
      scope, channel, address, purposes, is_system_fallback
    ) VALUES (
      'TENANT', 'email', 'invalid-fallback@example.test', ARRAY['system']::text[], true
    );
    RAISE EXCEPTION 'invalid system fallback sender unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_sender_identities (
      scope, tenant_id, channel, address, purposes, is_default,
      verification_status, status
    ) VALUES (
      'TENANT', '61616161-6161-6161-6161-616161616161', 'email',
      'second-default@tenant-a.test', ARRAY['transactional']::text[], true,
      'VERIFIED', 'ACTIVE'
    );
    RAISE EXCEPTION 'duplicate active default sender unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_sender_identities (
      scope, tenant_id, organization_id, channel, address, purposes
    ) VALUES (
      'ORGANIZATION', '61616161-6161-6161-6161-616161616161',
      '72720000-0000-0000-0000-000000000001', 'voice', '+15550000002',
      ARRAY['transactional']::text[]
    );
    RAISE EXCEPTION 'cross-tenant sender organization unexpectedly succeeded';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_sender_identities (
      scope, tenant_id, channel, address, purposes
    ) VALUES (
      'TENANT', '61616161-6161-6161-6161-616161616161', 'email',
      'bad-purpose@tenant-a.test', ARRAY['unsupported']::text[]
    );
    RAISE EXCEPTION 'invalid sender purpose unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_sender_test;
CREATE ROLE expadio_sender_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_sender_test;
GRANT SELECT, INSERT ON platform.communication_sender_identities TO expadio_sender_test;

SET ROLE expadio_sender_test;
SELECT set_config('app.tenant_id', '61616161-6161-6161-6161-616161616161', false);

DO $$
DECLARE
  visible_count integer;
  platform_count integer;
  tenant_count integer;
  organization_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM platform.communication_sender_identities;
  SELECT count(*) INTO platform_count
    FROM platform.communication_sender_identities WHERE scope = 'PLATFORM';
  SELECT count(*) INTO tenant_count
    FROM platform.communication_sender_identities WHERE scope = 'TENANT';
  SELECT count(*) INTO organization_count
    FROM platform.communication_sender_identities WHERE scope = 'ORGANIZATION';

  IF visible_count <> 3 THEN
    RAISE EXCEPTION 'tenant A expected platform + tenant + organization senders, got %', visible_count;
  END IF;
  IF platform_count <> 1 OR tenant_count <> 1 OR organization_count <> 1 THEN
    RAISE EXCEPTION 'tenant A sender scope visibility was incorrect';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_sender_identities (
      scope, channel, address, purposes
    ) VALUES (
      'PLATFORM', 'email', 'forbidden@expadio.test', ARRAY['system']::text[]
    );
    RAISE EXCEPTION 'tenant platform-sender write unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_sender_identities (
      scope, tenant_id, channel, address, purposes
    ) VALUES (
      'TENANT', '72727272-7272-7272-7272-727272727272', 'sms',
      '+15550000003', ARRAY['transactional']::text[]
    );
    RAISE EXCEPTION 'cross-tenant sender RLS write unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

SELECT 'communication sender identities smoke: ok' AS result;
