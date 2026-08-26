\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('15e6b7c8-29a3-44db-5c6d-7e8f90123456', 'Storage Tenant A'),
  ('26f7c8d9-3ab4-45ec-6d7e-8f9012345678', 'Storage Tenant B');

INSERT INTO platform.object_storage_operations (
  operation_id, request_id, tenant_id, requested_by_subject_id,
  operation, purpose, object_reference, source_reference,
  expected_sha256, content_type,
  retention_policy_key, retention_policy_version,
  required_residency_tags, required_compliance_tags,
  deletion_authorization_decision_id, idempotency_key,
  requested_at, status, content_reference, actual_sha256,
  connector_key, provider_key, region, completed_at,
  correlation_id, evidence_refs, source_references
) VALUES
  (
    'e0000000-0000-0000-0000-000000000001',
    'request-a', '15e6b7c8-29a3-44db-5c6d-7e8f90123456',
    'subject-a', 'STORE', 'Store approved document.',
    'object://tenant-a/document-1', 'upload://document-1',
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'application/pdf', 'business-document', 3,
    ARRAY['ca'], ARRAY['regulated'], NULL, 'store:a:1',
    '2026-08-26T00:00:00Z', 'STORED',
    'storage://tenant-a/document-1/v1',
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'tenant-storage-a', 'customer-storage', 'ca-central-1',
    '2026-08-26T00:00:01Z',
    'e0000000-0000-0000-0000-000000000101',
    ARRAY['approval://document-1'],
    ARRAY['upload://document-1']
  ),
  (
    'e0000000-0000-0000-0000-000000000002',
    'request-b', '26f7c8d9-3ab4-45ec-6d7e-8f9012345678',
    'subject-b', 'DELETE', 'Delete expired document.',
    'object://tenant-b/document-2', NULL, NULL, NULL,
    'business-document', 3,
    ARRAY['us'], ARRAY[]::text[], 'deletion-decision-b', 'delete:b:2',
    '2026-08-26T00:00:00Z', 'DELETED', NULL, NULL,
    'tenant-storage-b', 'customer-storage', 'us-east-1',
    '2026-08-26T00:00:01Z',
    'e0000000-0000-0000-0000-000000000102',
    ARRAY['approval://delete/document-2'],
    ARRAY['storage://tenant-b/document-2/v1']
  );

DROP ROLE IF EXISTS expadio_storage_history_test;
CREATE ROLE expadio_storage_history_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_storage_history_test;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform.object_storage_operations
  TO expadio_storage_history_test;

SET ROLE expadio_storage_history_test;
SELECT set_config(
  'app.tenant_id',
  '15e6b7c8-29a3-44db-5c6d-7e8f90123456',
  false
);

DO $$
DECLARE
  operation_count integer;
BEGIN
  SELECT count(*) INTO operation_count
    FROM platform.object_storage_operations;
  IF operation_count <> 1 THEN
    RAISE EXCEPTION 'tenant A can see another tenant storage history';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.object_storage_operations (
      operation_id, request_id, tenant_id, requested_by_subject_id,
      operation, purpose, object_reference,
      retention_policy_key, retention_policy_version,
      required_residency_tags, required_compliance_tags,
      deletion_authorization_decision_id, idempotency_key,
      requested_at, status, connector_key, provider_key, region,
      completed_at, correlation_id, evidence_refs, source_references
    ) VALUES (
      'e0000000-0000-0000-0000-000000000003',
      'cross-tenant', '26f7c8d9-3ab4-45ec-6d7e-8f9012345678',
      'subject-a', 'DELETE', 'Cross tenant deletion.',
      'object://tenant-b/document-3', 'business-document', 3,
      ARRAY['us'], ARRAY[]::text[], 'decision-cross', 'delete:cross',
      now(), 'DELETED', 'storage-b', 'provider-b', 'us-east-1',
      now(), 'e0000000-0000-0000-0000-000000000103',
      ARRAY['negative:test'], ARRAY['storage://tenant-b/document-3']
    );
    RAISE EXCEPTION 'cross-tenant storage history insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  changed_count integer;
BEGIN
  UPDATE platform.object_storage_operations
     SET purpose = 'Mutated'
   WHERE request_id = 'request-a';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'tenant storage mutation unexpectedly changed history';
  END IF;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    DELETE FROM platform.object_storage_operations
     WHERE request_id = 'request-b';
    RAISE EXCEPTION 'privileged storage deletion unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE
        'Object storage operation history is immutable%'
      THEN
        RAISE;
      END IF;
  END;
END;
$$;

SELECT 'Object storage history smoke: ok' AS result;
