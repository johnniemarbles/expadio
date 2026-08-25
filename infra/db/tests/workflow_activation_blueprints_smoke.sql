\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1', 'Activation Blueprint Tenant A'),
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'Activation Blueprint Tenant B');

INSERT INTO platform.workflow_activation_blueprints (
  tenant_id, blueprint_key, version, label, work_type_key,
  provisioning_model, steps, created_by_subject_id
) VALUES
  (
    NULL, 'partner-activation', 1, 'Platform partner activation',
    'partner-onboarding', 'SCOPED_WORKSPACE',
    '[{"stepKey":"create-workspace","label":"Create workspace","sequence":0,"requiredBeforeActive":true,"actionKey":"workspace.create"}]'::jsonb,
    'platform-admin'
  ),
  (
    'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1',
    'partner-activation', 1, 'Tenant A partner activation',
    'partner-onboarding', 'RESTRICTED_PORTAL',
    '[{"stepKey":"create-portal","label":"Create portal","sequence":0,"requiredBeforeActive":true,"actionKey":"portal.create"}]'::jsonb,
    'tenant-a-admin'
  ),
  (
    'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
    'partner-activation', 1, 'Tenant B partner activation',
    'partner-onboarding', 'ACCOUNT_ONLY',
    '[]'::jsonb,
    'tenant-b-admin'
  );

DROP ROLE IF EXISTS expadio_activation_blueprint_test;
CREATE ROLE expadio_activation_blueprint_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_activation_blueprint_test;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform.workflow_activation_blueprints
  TO expadio_activation_blueprint_test;

SET ROLE expadio_activation_blueprint_test;
SELECT set_config('app.tenant_id', 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1', false);

DO $$
DECLARE
  visible_count integer;
  changed_count integer;
BEGIN
  SELECT count(*) INTO visible_count
    FROM platform.workflow_activation_blueprints;

  IF visible_count <> 2 THEN
    RAISE EXCEPTION 'tenant A expected platform plus tenant blueprint, got %', visible_count;
  END IF;

  UPDATE platform.workflow_activation_blueprints
     SET label = 'mutated'
   WHERE tenant_id = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'tenant update unexpectedly affected % rows', changed_count;
  END IF;

  DELETE FROM platform.workflow_activation_blueprints
   WHERE tenant_id = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'tenant delete unexpectedly affected % rows', changed_count;
  END IF;
END;
$$;

INSERT INTO platform.workflow_activation_blueprints (
  tenant_id, blueprint_key, version, label, work_type_key,
  provisioning_model, steps, created_by_subject_id
) VALUES (
  'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1',
  'partner-activation', 2, 'Tenant A partner activation v2',
  'partner-onboarding', 'SCOPED_WORKSPACE', '[]'::jsonb, 'tenant-a-admin'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.workflow_activation_blueprints (
      tenant_id, blueprint_key, version, label, work_type_key,
      provisioning_model, steps, created_by_subject_id
    ) VALUES (
      'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
      'partner-activation', 2, 'Cross-tenant activation',
      'partner-onboarding', 'ACCOUNT_ONLY', '[]'::jsonb, 'tenant-a-admin'
    );
    RAISE EXCEPTION 'cross-tenant activation blueprint insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    UPDATE platform.workflow_activation_blueprints
       SET label = 'mutated'
     WHERE tenant_id = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'
       AND blueprint_key = 'partner-activation'
       AND version = 1;
    RAISE EXCEPTION 'privileged immutable blueprint update unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'workflow activation blueprint versions are immutable%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    DELETE FROM platform.workflow_activation_blueprints
     WHERE tenant_id = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'
       AND blueprint_key = 'partner-activation'
       AND version = 1;
    RAISE EXCEPTION 'privileged immutable blueprint delete unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'workflow activation blueprint versions are immutable%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

SELECT 'workflow activation blueprints smoke: ok' AS result;
