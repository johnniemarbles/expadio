\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1', 'Settings Tenant A'),
  ('f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2', 'Settings Tenant B');

INSERT INTO platform.configuration_setting_definitions (
  definition_id, setting_key, version, value_schema, classification,
  override_mode, allowed_override_levels, authored_by_subject_id,
  authored_at, effective_from, reason, evidence_refs
) VALUES (
  'f0000000-0000-0000-0000-000000000001',
  'workflow.concurrentCases', 1,
  '{"type":"integer","minimum":1}'::jsonb,
  'INTERNAL', 'BOUNDED',
  ARRAY['PLAN', 'VERTICAL', 'TENANT', 'BRAND', 'WORKSPACE'],
  'platform-admin', now(), '2026-01-01T00:00:00Z',
  'Create governed concurrency setting.', ARRAY['policy:concurrency']
);

INSERT INTO platform.configuration_setting_values (
  value_id, setting_key, definition_version, level, scope_id, tenant_id,
  record_version, value, effective_from, effective_until,
  authored_by_subject_id, authored_at, reason, correlation_id, evidence_refs
) VALUES
  ('f0000000-0000-0000-0000-000000000011',
   'workflow.concurrentCases', 1, 'PLATFORM', NULL, NULL,
   1, '100'::jsonb, '2026-01-01T00:00:00Z', NULL,
   'platform-admin', now(), 'Platform limit.',
   'f0000000-0000-0000-0000-000000000101', ARRAY['setting:platform']),
  ('f0000000-0000-0000-0000-000000000012',
   'workflow.concurrentCases', 1, 'VERTICAL', 'dental', NULL,
   1, '80'::jsonb, '2026-02-01T00:00:00Z', NULL,
   'vertical-admin', now(), 'Dental default.',
   'f0000000-0000-0000-0000-000000000102', ARRAY['setting:vertical']),
  ('f0000000-0000-0000-0000-000000000013',
   'workflow.concurrentCases', 1, 'TENANT',
   'f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1',
   'f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1',
   1, '60'::jsonb, '2026-03-01T00:00:00Z', NULL,
   'tenant-admin-a', now(), 'Tenant A limit.',
   'f0000000-0000-0000-0000-000000000103', ARRAY['setting:a']),
  ('f0000000-0000-0000-0000-000000000014',
   'workflow.concurrentCases', 1, 'TENANT',
   'f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2',
   'f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2',
   1, '50'::jsonb, '2026-03-01T00:00:00Z', NULL,
   'tenant-admin-b', now(), 'Tenant B limit.',
   'f0000000-0000-0000-0000-000000000104', ARRAY['setting:b']);

DROP ROLE IF EXISTS expadio_governed_settings_test;
CREATE ROLE expadio_governed_settings_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_governed_settings_test;
GRANT SELECT ON platform.configuration_setting_definitions
  TO expadio_governed_settings_test;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform.configuration_setting_values
  TO expadio_governed_settings_test;

SET ROLE expadio_governed_settings_test;
SELECT set_config(
  'app.tenant_id',
  'f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1',
  false
);

DO $$
DECLARE
  definition_count integer;
  value_count integer;
BEGIN
  SELECT count(*) INTO definition_count
    FROM platform.configuration_setting_definitions
   WHERE setting_key = 'workflow.concurrentCases';
  SELECT count(*) INTO value_count
    FROM platform.configuration_setting_values
   WHERE setting_key = 'workflow.concurrentCases';

  IF definition_count <> 1 OR value_count <> 3 THEN
    RAISE EXCEPTION 'tenant A expected workflow.concurrentCases definition, global values and own value only';
  END IF;
END;
$$;

INSERT INTO platform.configuration_setting_values (
  value_id, setting_key, definition_version, level, scope_id, tenant_id,
  record_version, value, effective_from, effective_until,
  authored_by_subject_id, authored_at, reason, correlation_id, evidence_refs
) VALUES (
  'f0000000-0000-0000-0000-000000000015',
  'workflow.concurrentCases', 1, 'WORKSPACE', 'workspace-a',
  'f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1',
  1, '40'::jsonb, '2026-04-01T00:00:00Z', NULL,
  'workspace-admin-a', now(), 'Workspace A limit.',
  'f0000000-0000-0000-0000-000000000105', ARRAY['setting:workspace:a']
);

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.configuration_setting_values (
      value_id, setting_key, definition_version, level, scope_id, tenant_id,
      record_version, value, effective_from, effective_until,
      authored_by_subject_id, authored_at, reason, correlation_id, evidence_refs
    ) VALUES (
      'f0000000-0000-0000-0000-000000000016',
      'workflow.concurrentCases', 1, 'TENANT',
      'f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2',
      'f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2',
      2, '45'::jsonb, '2026-04-01T00:00:00Z', NULL,
      'tenant-admin-a', now(), 'Cross tenant.',
      'f0000000-0000-0000-0000-000000000106', ARRAY['setting:cross']
    );
    RAISE EXCEPTION 'cross-tenant setting insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  changed_count integer;
BEGIN
  UPDATE platform.configuration_setting_values
     SET value = '999'::jsonb
   WHERE value_id = 'f0000000-0000-0000-0000-000000000013';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'tenant mutation unexpectedly changed history';
  END IF;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    UPDATE platform.configuration_setting_values
       SET value = '999'::jsonb
     WHERE value_id = 'f0000000-0000-0000-0000-000000000011';
    RAISE EXCEPTION 'privileged setting mutation unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'governed configuration history is immutable%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

SELECT 'governed configuration settings smoke: ok' AS result;
