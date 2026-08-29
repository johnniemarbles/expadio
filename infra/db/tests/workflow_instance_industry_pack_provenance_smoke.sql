\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('7e2e2e20-5a7a-4f00-9b11-6f3a8c2d9921', 'Workflow Pack provenance tenant');

SELECT set_config('app.tenant_id', '7e2e2e20-5a7a-4f00-9b11-6f3a8c2d9921', false);

INSERT INTO platform.workflow_instances (
  instance_id, tenant_id, work_type_key, subject_type, subject_id,
  blueprint_key, blueprint_version, blueprint_scope, state, revision,
  created_at, updated_at,
  industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
) VALUES (
  '7e2e2e20-5a7a-4f00-9b11-6f3a8c2d9922',
  '7e2e2e20-5a7a-4f00-9b11-6f3a8c2d9921',
  'crm.case', 'crm.case', 'case-1',
  'crm.case.lifecycle', 1, 'PLATFORM', 'CREATED', 0,
  now(), now(),
  'dentex', 7, 'TENANT_PUBLISHED'
);

DO $$
DECLARE
  row_record record;
BEGIN
  SELECT industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
    INTO row_record
    FROM platform.workflow_instances
   WHERE instance_id = '7e2e2e20-5a7a-4f00-9b11-6f3a8c2d9922';

  IF row_record.industry_pack_vertical_key <> 'dentex'
     OR row_record.industry_pack_version <> 7
     OR row_record.industry_pack_runtime_source <> 'TENANT_PUBLISHED' THEN
    RAISE EXCEPTION 'workflow Pack provenance was not stored exactly';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE platform.workflow_instances
       SET industry_pack_version = 8
     WHERE instance_id = '7e2e2e20-5a7a-4f00-9b11-6f3a8c2d9922';
    RAISE EXCEPTION 'workflow Pack provenance mutation unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO platform.workflow_instances (
      instance_id, tenant_id, work_type_key, subject_type, subject_id,
      blueprint_key, blueprint_version, blueprint_scope, state, revision,
      created_at, updated_at,
      industry_pack_vertical_key, industry_pack_runtime_source
    ) VALUES (
      '7e2e2e20-5a7a-4f00-9b11-6f3a8c2d9923',
      '7e2e2e20-5a7a-4f00-9b11-6f3a8c2d9921',
      'crm.case', 'crm.case', 'case-2',
      'crm.case.lifecycle', 1, 'PLATFORM', 'CREATED', 0,
      now(), now(),
      'dentex', 'TENANT_PUBLISHED'
    );
    RAISE EXCEPTION 'published workflow provenance without version unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

SELECT 'workflow instance Industry Pack provenance smoke: ok' AS result;
