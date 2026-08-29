\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('7f3a9c20-6b2d-4f11-9a77-100000000001', 'Industry Pack Tenant A'),
  ('7f3a9c20-6b2d-4f11-9a77-100000000002', 'Industry Pack Tenant B');

INSERT INTO platform.industry_pack_versions (
  pack_version_id, tenant_id, vertical_key, version, source, state, revision,
  definition, created_by_subject_id, updated_by_subject_id,
  published_by_subject_id, published_at
) VALUES
  (
    'd1000000-0000-0000-0000-000000000001', NULL, 'dentex', 1,
    'CODE_BASELINE', 'PUBLISHED', 1,
    '{"verticalKey":"dentex","label":"DENTEX"}'::jsonb,
    'system', 'system', 'system', now()
  ),
  (
    'd1000000-0000-0000-0000-000000000002',
    '7f3a9c20-6b2d-4f11-9a77-100000000001', 'dentex', 2,
    'TENANT_AUTHORED', 'DRAFT', 1,
    '{"verticalKey":"dentex","label":"Tenant DENTEX"}'::jsonb,
    'subject-a', 'subject-a', NULL, NULL
  ),
  (
    'd2000000-0000-0000-0000-000000000001',
    '7f3a9c20-6b2d-4f11-9a77-100000000002', 'dentex', 2,
    'TENANT_AUTHORED', 'DRAFT', 1,
    '{"verticalKey":"dentex","label":"Tenant B DENTEX"}'::jsonb,
    'subject-b', 'subject-b', NULL, NULL
  );

UPDATE platform.industry_pack_versions
   SET definition = '{"verticalKey":"dentex","label":"Tenant DENTEX v2"}'::jsonb,
       revision = 2,
       updated_by_subject_id = 'subject-a',
       updated_at = now()
 WHERE pack_version_id = 'd1000000-0000-0000-0000-000000000002';

DO $$
BEGIN
  BEGIN
    UPDATE platform.industry_pack_versions
       SET definition = '{"verticalKey":"dentex","label":"bad"}'::jsonb
     WHERE pack_version_id = 'd1000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'draft edit without revision increment unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE platform.industry_pack_versions
       SET definition = '{"verticalKey":"dentex","label":"mutated published"}'::jsonb
     WHERE pack_version_id = 'd1000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'published definition mutation unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    DELETE FROM platform.industry_pack_versions
     WHERE pack_version_id = 'd1000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'published version delete unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_industry_pack_test;
CREATE ROLE expadio_industry_pack_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_industry_pack_test;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.industry_pack_versions TO expadio_industry_pack_test;

SET ROLE expadio_industry_pack_test;
SELECT set_config('app.tenant_id', '7f3a9c20-6b2d-4f11-9a77-100000000001', false);

DO $$
DECLARE
  visible_count integer;
  own_count integer;
  platform_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM platform.industry_pack_versions;
  SELECT count(*) INTO own_count FROM platform.industry_pack_versions
    WHERE tenant_id = '7f3a9c20-6b2d-4f11-9a77-100000000001';
  SELECT count(*) INTO platform_count FROM platform.industry_pack_versions
    WHERE tenant_id IS NULL;

  IF visible_count <> 2 OR own_count <> 1 OR platform_count <> 1 THEN
    RAISE EXCEPTION 'industry pack tenant visibility incorrect: visible %, own %, platform %',
      visible_count, own_count, platform_count;
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.industry_pack_versions (
      tenant_id, vertical_key, version, source, state, revision,
      definition, created_by_subject_id, updated_by_subject_id
    ) VALUES (
      '7f3a9c20-6b2d-4f11-9a77-100000000002', 'forbidden', 1,
      'TENANT_AUTHORED', 'DRAFT', 1, '{}'::jsonb, 'x', 'x'
    );
    RAISE EXCEPTION 'cross-tenant industry pack write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO platform.industry_pack_versions (
      vertical_key, version, source, state, revision,
      definition, created_by_subject_id, updated_by_subject_id
    ) VALUES (
      'forbidden-platform', 1, 'PLATFORM_AUTHORED', 'DRAFT', 1,
      '{}'::jsonb, 'x', 'x'
    );
    RAISE EXCEPTION 'tenant platform industry pack write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

DELETE FROM platform.industry_pack_versions
 WHERE pack_version_id = 'd1000000-0000-0000-0000-000000000002';

RESET ROLE;

SELECT 'industry pack versions smoke: ok' AS result;
