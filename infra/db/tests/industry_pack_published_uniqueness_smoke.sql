\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('8a3b9c20-6b2d-4f11-9a77-100000000001', 'Pack Publish Tenant A'),
  ('8a3b9c20-6b2d-4f11-9a77-100000000002', 'Pack Publish Tenant B');

INSERT INTO platform.industry_pack_versions (
  tenant_id, vertical_key, version, source, state, revision,
  definition, created_by_subject_id, updated_by_subject_id,
  published_by_subject_id, published_at
) VALUES
  (NULL, 'publish-proof', 1, 'PLATFORM_AUTHORED', 'PUBLISHED', 1,
   '{"verticalKey":"publish-proof"}'::jsonb, 'system', 'system', 'system', now()),
  ('8a3b9c20-6b2d-4f11-9a77-100000000001', 'publish-proof', 1,
   'TENANT_AUTHORED', 'PUBLISHED', 1,
   '{"verticalKey":"publish-proof"}'::jsonb, 'a', 'a', 'a', now()),
  ('8a3b9c20-6b2d-4f11-9a77-100000000002', 'publish-proof', 1,
   'TENANT_AUTHORED', 'PUBLISHED', 1,
   '{"verticalKey":"publish-proof"}'::jsonb, 'b', 'b', 'b', now());

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.industry_pack_versions (
      vertical_key, version, source, state, revision,
      definition, created_by_subject_id, updated_by_subject_id,
      published_by_subject_id, published_at
    ) VALUES (
      'publish-proof', 2, 'PLATFORM_AUTHORED', 'PUBLISHED', 1,
      '{"verticalKey":"publish-proof"}'::jsonb, 'system', 'system', 'system', now()
    );
    RAISE EXCEPTION 'second platform published version unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO platform.industry_pack_versions (
      tenant_id, vertical_key, version, source, state, revision,
      definition, created_by_subject_id, updated_by_subject_id,
      published_by_subject_id, published_at
    ) VALUES (
      '8a3b9c20-6b2d-4f11-9a77-100000000001', 'publish-proof', 2,
      'TENANT_AUTHORED', 'PUBLISHED', 1,
      '{"verticalKey":"publish-proof"}'::jsonb, 'a', 'a', 'a', now()
    );
    RAISE EXCEPTION 'second tenant published version unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$$;

SELECT 'industry pack published uniqueness smoke: ok' AS result;
