\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('61616161-6161-6161-6161-616161616161', 'Pack provenance tenant');

SELECT set_config('app.tenant_id', '61616161-6161-6161-6161-616161616161', false);

INSERT INTO platform.crm_cases (
  case_id, tenant_id, subject,
  industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
) VALUES (
  '61610000-0000-0000-0000-000000000001',
  '61616161-6161-6161-6161-616161616161',
  'Governed treatment',
  'dentex', 7, 'TENANT_PUBLISHED'
);

DO $$
DECLARE
  row_record record;
BEGIN
  SELECT industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
    INTO row_record
    FROM platform.crm_cases
   WHERE case_id = '61610000-0000-0000-0000-000000000001';

  IF row_record.industry_pack_vertical_key <> 'dentex'
     OR row_record.industry_pack_version <> 7
     OR row_record.industry_pack_runtime_source <> 'TENANT_PUBLISHED' THEN
    RAISE EXCEPTION 'published Pack provenance was not stored exactly';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.crm_cases (
      tenant_id, subject,
      industry_pack_vertical_key, industry_pack_runtime_source
    ) VALUES (
      '61616161-6161-6161-6161-616161616161',
      'Missing published version',
      'dentex', 'TENANT_PUBLISHED'
    );
    RAISE EXCEPTION 'published provenance without version unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO platform.crm_cases (
      tenant_id, subject,
      industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source
    ) VALUES (
      '61616161-6161-6161-6161-616161616161',
      'Invalid neutral provenance',
      'dentex', 1, 'NEUTRAL'
    );
    RAISE EXCEPTION 'neutral provenance with Pack identity unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE platform.crm_cases
       SET industry_pack_version = 8
     WHERE case_id = '61610000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Pack provenance mutation unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

SELECT 'crm case Industry Pack provenance smoke: ok' AS result;
