\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('92929292-9292-9292-9292-929292929292', 'Workflow Tenant A'),
  ('94949494-9494-9494-9494-949494949494', 'Workflow Tenant B');

INSERT INTO platform.workflow_blueprints (
  blueprint_id, tenant_id, blueprint_key, version, label, work_type_key,
  source, state, allows_stage_addition, allows_stage_reorder,
  allows_stage_deactivation, minimum_required_stage_keys, stages
) VALUES
  (
    '92920000-0000-0000-0000-000000000001', NULL,
    'partner-onboarding', 1, 'Platform partner onboarding', 'partner-onboarding',
    'PLATFORM', 'ACTIVE', true, true, true,
    ARRAY['qualification','decision'],
    '[{"stageKey":"qualification","sequence":0},{"stageKey":"decision","sequence":1}]'::jsonb
  ),
  (
    '92920000-0000-0000-0000-000000000002',
    '92929292-9292-9292-9292-929292929292',
    'partner-onboarding', 1, 'Tenant A partner onboarding', 'partner-onboarding',
    'TENANT_CUSTOMIZED', 'ACTIVE', true, true, true,
    ARRAY['qualification','decision'],
    '[{"stageKey":"qualification","sequence":0},{"stageKey":"review","sequence":1},{"stageKey":"decision","sequence":2}]'::jsonb
  ),
  (
    '94940000-0000-0000-0000-000000000001',
    '94949494-9494-9494-9494-949494949494',
    'partner-onboarding', 1, 'Tenant B partner onboarding', 'partner-onboarding',
    'TENANT_CUSTOMIZED', 'ACTIVE', true, true, true,
    ARRAY['qualification','decision'],
    '[{"stageKey":"qualification","sequence":0},{"stageKey":"decision","sequence":1}]'::jsonb
  );

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.workflow_blueprints (
      tenant_id, blueprint_key, version, label, work_type_key, source, state, stages
    ) VALUES (
      '92929292-9292-9292-9292-929292929292',
      'invalid-platform-scope', 1, 'Invalid', 'invalid', 'PLATFORM', 'DRAFT', '[]'::jsonb
    );
    RAISE EXCEPTION 'platform blueprint with tenant unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO platform.workflow_blueprints (
      blueprint_key, version, label, work_type_key, source, state, stages
    ) VALUES (
      'invalid-tenant-scope', 1, 'Invalid', 'invalid', 'TENANT_CUSTOMIZED', 'DRAFT', '[]'::jsonb
    );
    RAISE EXCEPTION 'tenant blueprint without tenant unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.workflow_blueprints (
      blueprint_key, version, label, work_type_key, source, state, stages
    ) VALUES (
      'partner-onboarding', 1, 'Duplicate platform', 'partner-onboarding',
      'PLATFORM', 'ACTIVE', '[]'::jsonb
    );
    RAISE EXCEPTION 'duplicate platform blueprint identity unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO platform.workflow_blueprints (
      tenant_id, blueprint_key, version, label, work_type_key, source, state, stages
    ) VALUES (
      '92929292-9292-9292-9292-929292929292',
      'partner-onboarding', 1, 'Duplicate tenant A', 'partner-onboarding',
      'TENANT_CUSTOMIZED', 'ACTIVE', '[]'::jsonb
    );
    RAISE EXCEPTION 'duplicate tenant blueprint identity unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_workflow_test;
CREATE ROLE expadio_workflow_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_workflow_test;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.workflow_blueprints TO expadio_workflow_test;

SET ROLE expadio_workflow_test;
SELECT set_config('app.tenant_id', '92929292-9292-9292-9292-929292929292', false);

DO $$
DECLARE
  visible_count integer;
  platform_count integer;
  tenant_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM platform.workflow_blueprints;
  SELECT count(*) INTO platform_count
    FROM platform.workflow_blueprints WHERE tenant_id IS NULL;
  SELECT count(*) INTO tenant_count
    FROM platform.workflow_blueprints
    WHERE tenant_id = '92929292-9292-9292-9292-929292929292';

  IF visible_count <> 2 THEN
    RAISE EXCEPTION 'tenant A expected platform + own blueprint, got %', visible_count;
  END IF;
  IF platform_count <> 1 OR tenant_count <> 1 THEN
    RAISE EXCEPTION 'tenant A workflow blueprint visibility was incorrect';
  END IF;
END;
$$;

INSERT INTO platform.workflow_blueprints (
  tenant_id, blueprint_key, version, label, work_type_key, source, state, stages
) VALUES (
  '92929292-9292-9292-9292-929292929292',
  'tenant-a-custom', 1, 'Tenant A custom', 'custom',
  'TENANT_CUSTOMIZED', 'DRAFT', '[]'::jsonb
);

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.workflow_blueprints (
      blueprint_key, version, label, work_type_key, source, state, stages
    ) VALUES (
      'forbidden-platform', 1, 'Forbidden platform', 'custom',
      'PLATFORM', 'DRAFT', '[]'::jsonb
    );
    RAISE EXCEPTION 'tenant platform blueprint write unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO platform.workflow_blueprints (
      tenant_id, blueprint_key, version, label, work_type_key, source, state, stages
    ) VALUES (
      '94949494-9494-9494-9494-949494949494',
      'forbidden-cross-tenant', 1, 'Forbidden tenant B', 'custom',
      'TENANT_CUSTOMIZED', 'DRAFT', '[]'::jsonb
    );
    RAISE EXCEPTION 'cross-tenant workflow blueprint write unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

SELECT 'workflow blueprints smoke: ok' AS result;
