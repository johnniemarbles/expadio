\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('abababab-abab-abab-abab-abababababab', 'Suppression Tenant A'),
  ('cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd', 'Suppression Tenant C');

INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'abababab-abab-abab-abab-abababababab', 'Suppression Org A'),
  ('c1111111-1111-1111-1111-111111111111', 'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd', 'Suppression Org C');

INSERT INTO platform.communication_suppressions (
  tenant_id, organization_id, recipient_key, channel, reason, source_message_id
) VALUES
  (
    'abababab-abab-abab-abab-abababababab',
    NULL,
    'person@example.com',
    'email',
    'BOUNCE',
    'message-a-1'
  ),
  (
    'abababab-abab-abab-abab-abababababab',
    'a1111111-1111-1111-1111-111111111111',
    '+14165550100',
    'sms',
    'OPT_OUT',
    'message-a-2'
  ),
  (
    'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd',
    'c1111111-1111-1111-1111-111111111111',
    'other@example.com',
    'email',
    'UNSUBSCRIBE',
    'message-c-1'
  );

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_suppressions (
      tenant_id, organization_id, recipient_key, channel, reason
    ) VALUES (
      'abababab-abab-abab-abab-abababababab',
      'c1111111-1111-1111-1111-111111111111',
      'cross-tenant@example.com',
      'email',
      'LEGAL_HOLD'
    );
    RAISE EXCEPTION 'cross-tenant suppression organization unexpectedly succeeded';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_suppressions (
      tenant_id, organization_id, recipient_key, channel, reason
    ) VALUES (
      'abababab-abab-abab-abab-abababababab',
      NULL,
      'PERSON@EXAMPLE.COM',
      'email',
      'COMPLAINT'
    );
    RAISE EXCEPTION 'case-insensitive duplicate active suppression unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_suppression_test;
CREATE ROLE expadio_suppression_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_suppression_test;
GRANT SELECT, INSERT ON platform.communication_suppressions TO expadio_suppression_test;

SET ROLE expadio_suppression_test;
SELECT set_config('app.tenant_id', 'abababab-abab-abab-abab-abababababab', false);

DO $$
DECLARE
  visible_count integer;
  tenant_wide_count integer;
  org_specific_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM platform.communication_suppressions;
  SELECT count(*) INTO tenant_wide_count
    FROM platform.communication_suppressions WHERE organization_id IS NULL;
  SELECT count(*) INTO org_specific_count
    FROM platform.communication_suppressions
   WHERE organization_id = 'a1111111-1111-1111-1111-111111111111';

  IF visible_count <> 2 THEN
    RAISE EXCEPTION 'tenant A expected 2 visible suppressions, got %', visible_count;
  END IF;
  IF tenant_wide_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected 1 tenant-wide suppression, got %', tenant_wide_count;
  END IF;
  IF org_specific_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected 1 organization suppression, got %', org_specific_count;
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_suppressions (
      tenant_id, organization_id, recipient_key, channel, reason
    ) VALUES (
      'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd',
      'c1111111-1111-1111-1111-111111111111',
      'forbidden@example.com',
      'email',
      'BOUNCE'
    );
    RAISE EXCEPTION 'cross-tenant suppression RLS write unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

SELECT 'communication suppressions smoke: ok' AS result;
