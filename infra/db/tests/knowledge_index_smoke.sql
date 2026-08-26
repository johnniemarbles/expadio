\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('f3c495a6-0781-42b9-3a4b-5c6d7e8f9012', 'Knowledge Tenant A'),
  ('04d5a6b7-1892-43ca-4b5c-6d7e8f901234', 'Knowledge Tenant B');

INSERT INTO platform.knowledge_documents (
  tenant_id, collection_reference, document_reference,
  document_version, source_reference, source_digest,
  metadata_reference,
  embedding_configuration_key, embedding_configuration_version,
  access_policy_key, access_policy_version,
  retention_policy_key, retention_policy_version,
  retention_expires_at, authorization_decision_id,
  index_reference, indexed_at, indexed_by_subject_id, reason,
  correlation_id, evidence_refs
) VALUES
  (
    'f3c495a6-0781-42b9-3a4b-5c6d7e8f9012',
    'collection://tenant-a/policies', 'document://policy/a',
    1, 'object://tenant-a/policy-a',
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'metadata://policy/a/v1',
    'knowledge-embedding', 2, 'policy-access', 4,
    'policy-retention', 1, '2027-08-25T22:00:00Z',
    'authorization-a', 'index://policy/a/v1',
    '2026-08-25T22:00:00Z',
    'subject-a', 'Index approved policy.',
    'd0000000-0000-0000-0000-000000000101',
    ARRAY['approval://policy/a/v1']
  ),
  (
    '04d5a6b7-1892-43ca-4b5c-6d7e8f901234',
    'collection://tenant-b/policies', 'document://policy/b',
    1, 'object://tenant-b/policy-b',
    'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    'metadata://policy/b/v1',
    'knowledge-embedding', 2, 'policy-access', 4,
    'policy-retention', 1, '2027-08-25T22:00:00Z',
    'authorization-b', 'index://policy/b/v1',
    '2026-08-25T22:00:00Z',
    'subject-b', 'Index approved policy.',
    'd0000000-0000-0000-0000-000000000102',
    ARRAY['approval://policy/b/v1']
  );

INSERT INTO platform.knowledge_chunks (
  tenant_id, document_reference, document_version,
  ordinal, chunk_reference, content_reference, content_digest
) VALUES
  (
    'f3c495a6-0781-42b9-3a4b-5c6d7e8f9012',
    'document://policy/a', 1, 0, 'chunk-a-0',
    'content://policy/a/v1/chunk-0',
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  ),
  (
    '04d5a6b7-1892-43ca-4b5c-6d7e8f901234',
    'document://policy/b', 1, 0, 'chunk-b-0',
    'content://policy/b/v1/chunk-0',
    'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
  );

DROP ROLE IF EXISTS expadio_knowledge_test;
CREATE ROLE expadio_knowledge_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_knowledge_test;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform.knowledge_documents, platform.knowledge_chunks
  TO expadio_knowledge_test;

SET ROLE expadio_knowledge_test;
SELECT set_config(
  'app.tenant_id',
  'f3c495a6-0781-42b9-3a4b-5c6d7e8f9012',
  false
);

DO $$
DECLARE
  document_count integer;
  chunk_count integer;
BEGIN
  SELECT count(*) INTO document_count
    FROM platform.knowledge_documents;
  SELECT count(*) INTO chunk_count
    FROM platform.knowledge_chunks;
  IF document_count <> 1 OR chunk_count <> 1 THEN
    RAISE EXCEPTION 'tenant A can see another tenant knowledge index';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.knowledge_chunks (
      tenant_id, document_reference, document_version,
      ordinal, chunk_reference, content_reference, content_digest
    ) VALUES (
      '04d5a6b7-1892-43ca-4b5c-6d7e8f901234',
      'document://policy/b', 1, 1, 'chunk-cross',
      'content://policy/b/v1/chunk-cross',
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    );
    RAISE EXCEPTION 'cross-tenant knowledge insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  changed_count integer;
BEGIN
  UPDATE platform.knowledge_documents
     SET reason = 'Mutated'
   WHERE document_reference = 'document://policy/a';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'tenant knowledge mutation unexpectedly changed history';
  END IF;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    UPDATE platform.knowledge_chunks
       SET content_reference = 'content://mutated'
     WHERE chunk_reference = 'chunk-b-0';
    RAISE EXCEPTION 'privileged knowledge mutation unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'Knowledge index history is immutable%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

SELECT 'Knowledge index smoke: ok' AS result;
