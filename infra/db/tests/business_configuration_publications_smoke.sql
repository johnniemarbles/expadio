\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1', 'Config Tenant A'),
  ('e2e2e2e2-e2e2-e2e2-e2e2-e2e2e2e2e2e2', 'Config Tenant B');

INSERT INTO platform.business_configuration_publications (
  publication_id, changeset_id, scope_kind, scope_key, tenant_id,
  base_revision, revision, published_by_subject_id, published_at,
  reason, evidence_refs
) VALUES
  ('e0000000-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-000000000011',
   'PLATFORM', NULL, NULL, 0, 1, 'platform-admin', now(),
   'Platform defaults.', ARRAY['config:platform']),
  ('e0000000-0000-0000-0000-000000000002',
   'e0000000-0000-0000-0000-000000000012',
   'VERTICAL', 'dental', NULL, 0, 1, 'vertical-admin', now(),
   'Dental ontology.', ARRAY['config:vertical']),
  ('e0000000-0000-0000-0000-000000000003',
   'e0000000-0000-0000-0000-000000000013',
   'TENANT', 'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1',
   'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1',
   0, 1, 'tenant-admin-a', now(), 'Tenant A labels.', ARRAY['config:a']),
  ('e0000000-0000-0000-0000-000000000004',
   'e0000000-0000-0000-0000-000000000014',
   'TENANT', 'e2e2e2e2-e2e2-e2e2-e2e2-e2e2e2e2e2e2',
   'e2e2e2e2-e2e2-e2e2-e2e2-e2e2e2e2e2e2',
   0, 1, 'tenant-admin-b', now(), 'Tenant B labels.', ARRAY['config:b']);

INSERT INTO platform.business_configuration_objects (
  object_id, publication_id, scope_kind, scope_key, tenant_id, kind, object_key,
  version, label, payload, dependencies, authored_by_subject_id, authored_at
) VALUES
  ('e0000000-0000-0000-0000-000000000021',
   'e0000000-0000-0000-0000-000000000001',
   'PLATFORM', NULL, NULL, 'POLICY', 'security-invariants', 1,
   'Security invariants', '{"tenantIsolation":true}'::jsonb, '[]'::jsonb,
   'platform-admin', now()),
  ('e0000000-0000-0000-0000-000000000022',
   'e0000000-0000-0000-0000-000000000002',
   'VERTICAL', 'dental', NULL, 'ONTOLOGY', 'dental-directory', 1,
   'Dental directory', '{"entities":["Practice"]}'::jsonb, '[]'::jsonb,
   'vertical-admin', now()),
  ('e0000000-0000-0000-0000-000000000023',
   'e0000000-0000-0000-0000-000000000003',
   'TENANT', 'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1',
   'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1',
   'TERMINOLOGY', 'customer-labels', 1, 'Tenant A labels',
   '{"customer":"Patient"}'::jsonb, '[]'::jsonb, 'tenant-admin-a', now()),
  ('e0000000-0000-0000-0000-000000000024',
   'e0000000-0000-0000-0000-000000000004',
   'TENANT', 'e2e2e2e2-e2e2-e2e2-e2e2-e2e2e2e2e2e2',
   'e2e2e2e2-e2e2-e2e2-e2e2-e2e2e2e2e2e2',
   'TERMINOLOGY', 'customer-labels', 1, 'Tenant B labels',
   '{"customer":"Client"}'::jsonb, '[]'::jsonb, 'tenant-admin-b', now());

DROP ROLE IF EXISTS expadio_business_config_test;
CREATE ROLE expadio_business_config_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_business_config_test;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform.business_configuration_publications,
     platform.business_configuration_objects
  TO expadio_business_config_test;

SET ROLE expadio_business_config_test;
SELECT set_config(
  'app.tenant_id',
  'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1',
  false
);

DO $$
DECLARE
  publication_count integer;
  object_count integer;
BEGIN
  SELECT count(*) INTO publication_count
    FROM platform.business_configuration_publications;
  SELECT count(*) INTO object_count
    FROM platform.business_configuration_objects;

  IF publication_count <> 3 OR object_count <> 3 THEN
    RAISE EXCEPTION 'tenant A expected platform, vertical and own config only';
  END IF;
END;
$$;

INSERT INTO platform.business_configuration_publications (
  publication_id, changeset_id, scope_kind, scope_key, tenant_id,
  base_revision, revision, published_by_subject_id, published_at,
  reason, evidence_refs
) VALUES (
  'e0000000-0000-0000-0000-000000000005',
  'e0000000-0000-0000-0000-000000000015',
  'TENANT', 'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1',
  'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1',
  1, 2, 'tenant-admin-a', now(), 'Tenant A revision two.',
  ARRAY['config:a:2']
);

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.business_configuration_publications (
      publication_id, changeset_id, scope_kind, scope_key, tenant_id,
      base_revision, revision, published_by_subject_id, published_at,
      reason, evidence_refs
    ) VALUES (
      'e0000000-0000-0000-0000-000000000006',
      'e0000000-0000-0000-0000-000000000016',
      'TENANT', 'e2e2e2e2-e2e2-e2e2-e2e2-e2e2e2e2e2e2',
      'e2e2e2e2-e2e2-e2e2-e2e2-e2e2e2e2e2e2',
      1, 2, 'tenant-admin-a', now(), 'Cross tenant.',
      ARRAY['config:cross']
    );
    RAISE EXCEPTION 'cross-tenant publication unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege OR serialization_failure THEN NULL;
  END;

  BEGIN
    INSERT INTO platform.business_configuration_publications (
      publication_id, changeset_id, scope_kind, scope_key, tenant_id,
      base_revision, revision, published_by_subject_id, published_at,
      reason, evidence_refs
    ) VALUES (
      'e0000000-0000-0000-0000-000000000007',
      'e0000000-0000-0000-0000-000000000017',
      'TENANT', 'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1',
      'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1',
      1, 2, 'tenant-admin-a', now(), 'Stale revision.',
      ARRAY['config:stale']
    );
    RAISE EXCEPTION 'stale configuration revision unexpectedly succeeded';
  EXCEPTION
    WHEN serialization_failure THEN NULL;
  END;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    UPDATE platform.business_configuration_publications
       SET reason = 'changed'
     WHERE publication_id = 'e0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'immutable publication update unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'published business configuration is immutable%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

SELECT 'business configuration publication smoke: ok' AS result;
