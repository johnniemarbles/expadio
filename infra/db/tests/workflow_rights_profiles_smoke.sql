\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('97979797-9797-9797-9797-979797979797', 'Rights Profile Tenant A'),
  ('98989898-9898-9898-9898-989898989898', 'Rights Profile Tenant B');

INSERT INTO platform.workflow_rights_profiles (
  rights_profile_id, tenant_id, profile_key, version, label, right_types,
  maximum_scope, permits_exclusivity, permits_delegation,
  permits_sub_appointment, default_duration, renewal_model, created_by_subject_id
) VALUES
  (
    '97970000-0000-0000-0000-000000000001', NULL,
    'standard-partner', 1, 'Platform standard partner', ARRAY['OPERATE','SELL'],
    '{"channelKeys":["direct"]}'::jsonb, false, true, false,
    'P1Y', 'RENEWABLE', 'platform-admin'
  ),
  (
    '97970000-0000-0000-0000-000000000002',
    '97979797-9797-9797-9797-979797979797',
    'standard-partner', 1, 'Tenant A standard partner', ARRAY['OPERATE'],
    '{"channelKeys":["direct"]}'::jsonb, false, false, false,
    'P6M', 'FIXED', 'tenant-a-admin'
  ),
  (
    '98980000-0000-0000-0000-000000000001',
    '98989898-9898-9898-9898-989898989898',
    'tenant-b-only', 1, 'Tenant B only', ARRAY['OPERATE'],
    NULL, false, false, false,
    NULL, NULL, 'tenant-b-admin'
  );

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.workflow_rights_profiles (
      tenant_id, profile_key, version, label, right_types
    ) VALUES (
      NULL, 'empty-rights', 1, 'Invalid empty rights', ARRAY[]::text[]
    );
    RAISE EXCEPTION 'empty rights profile unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO platform.workflow_rights_profiles (
      tenant_id, profile_key, version, label, right_types
    ) VALUES (
      NULL, 'standard-partner', 1, 'Duplicate platform', ARRAY['OPERATE']
    );
    RAISE EXCEPTION 'duplicate platform profile version unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  BEGIN
    UPDATE platform.workflow_rights_profiles
       SET label = 'Mutated'
     WHERE rights_profile_id = '97970000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'immutable rights profile update unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN NULL;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_rights_profile_test;
CREATE ROLE expadio_rights_profile_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_rights_profile_test;
GRANT SELECT, INSERT ON platform.workflow_rights_profiles TO expadio_rights_profile_test;

SET ROLE expadio_rights_profile_test;
SELECT set_config('app.tenant_id', '97979797-9797-9797-9797-979797979797', false);

DO $$
DECLARE
  visible_count integer;
  platform_count integer;
  tenant_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM platform.workflow_rights_profiles;
  SELECT count(*) INTO platform_count
    FROM platform.workflow_rights_profiles WHERE tenant_id IS NULL;
  SELECT count(*) INTO tenant_count
    FROM platform.workflow_rights_profiles
    WHERE tenant_id = '97979797-9797-9797-9797-979797979797';

  IF visible_count <> 2 OR platform_count <> 1 OR tenant_count <> 1 THEN
    RAISE EXCEPTION 'rights profile visibility incorrect: total %, platform %, tenant %',
      visible_count, platform_count, tenant_count;
  END IF;
END;
$$;

INSERT INTO platform.workflow_rights_profiles (
  tenant_id, profile_key, version, label, right_types
) VALUES (
  '97979797-9797-9797-9797-979797979797',
  'tenant-a-custom', 1, 'Tenant A custom', ARRAY['OPERATE']
);

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.workflow_rights_profiles (
      tenant_id, profile_key, version, label, right_types
    ) VALUES (
      NULL, 'forbidden-platform', 1, 'Forbidden platform', ARRAY['OPERATE']
    );
    RAISE EXCEPTION 'tenant platform rights profile write unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO platform.workflow_rights_profiles (
      tenant_id, profile_key, version, label, right_types
    ) VALUES (
      '98989898-9898-9898-9898-989898989898',
      'forbidden-cross-tenant', 1, 'Forbidden tenant B', ARRAY['OPERATE']
    );
    RAISE EXCEPTION 'cross-tenant rights profile write unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

SELECT 'workflow rights profiles smoke: ok' AS result;
