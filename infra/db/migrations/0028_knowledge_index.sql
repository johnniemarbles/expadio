BEGIN;

CREATE TABLE platform.knowledge_documents (
  tenant_id uuid NOT NULL
    REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  collection_reference text NOT NULL
    CHECK (btrim(collection_reference) <> ''),
  document_reference text NOT NULL
    CHECK (btrim(document_reference) <> ''),
  document_version integer NOT NULL CHECK (document_version > 0),
  source_reference text NOT NULL CHECK (btrim(source_reference) <> ''),
  source_digest text NOT NULL CHECK (
    source_digest ~ '^[0-9a-fA-F]{64}$'
  ),
  metadata_reference text NOT NULL
    CHECK (btrim(metadata_reference) <> ''),
  embedding_configuration_key text NOT NULL
    CHECK (btrim(embedding_configuration_key) <> ''),
  embedding_configuration_version integer NOT NULL
    CHECK (embedding_configuration_version > 0),
  access_policy_key text NOT NULL
    CHECK (btrim(access_policy_key) <> ''),
  access_policy_version integer NOT NULL
    CHECK (access_policy_version > 0),
  retention_policy_key text NOT NULL
    CHECK (btrim(retention_policy_key) <> ''),
  retention_policy_version integer NOT NULL
    CHECK (retention_policy_version > 0),
  retention_expires_at timestamptz,
  authorization_decision_id text NOT NULL
    CHECK (btrim(authorization_decision_id) <> ''),
  indexed_at timestamptz NOT NULL,
  indexed_by_subject_id text NOT NULL
    CHECK (btrim(indexed_by_subject_id) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  correlation_id uuid NOT NULL,
  evidence_refs text[] NOT NULL CHECK (
    cardinality(evidence_refs) > 0
    AND array_position(evidence_refs, NULL) IS NULL
  ),
  PRIMARY KEY (tenant_id, document_reference, document_version),
  UNIQUE (
    tenant_id, collection_reference,
    document_reference, document_version
  ),
  CHECK (
    retention_expires_at IS NULL
    OR retention_expires_at > indexed_at
  )
);

CREATE TABLE platform.knowledge_chunks (
  tenant_id uuid NOT NULL,
  document_reference text NOT NULL,
  document_version integer NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  chunk_reference text NOT NULL CHECK (btrim(chunk_reference) <> ''),
  content_reference text NOT NULL
    CHECK (btrim(content_reference) <> ''),
  content_digest text NOT NULL CHECK (
    content_digest ~ '^[0-9a-fA-F]{64}$'
  ),
  PRIMARY KEY (
    tenant_id, document_reference, document_version, ordinal
  ),
  UNIQUE (
    tenant_id, document_reference, document_version, chunk_reference
  ),
  FOREIGN KEY (tenant_id, document_reference, document_version)
    REFERENCES platform.knowledge_documents(
      tenant_id, document_reference, document_version
    )
);

CREATE INDEX knowledge_documents_collection_idx
  ON platform.knowledge_documents (
    tenant_id, collection_reference, indexed_at DESC
  );

CREATE INDEX knowledge_documents_retention_idx
  ON platform.knowledge_documents (
    tenant_id, retention_expires_at
  )
  WHERE retention_expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION platform.reject_knowledge_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Knowledge index history is immutable';
END;
$$;

CREATE TRIGGER knowledge_documents_immutable
BEFORE UPDATE OR DELETE ON platform.knowledge_documents
FOR EACH ROW EXECUTE FUNCTION platform.reject_knowledge_history_mutation();

CREATE TRIGGER knowledge_chunks_immutable
BEFORE UPDATE OR DELETE ON platform.knowledge_chunks
FOR EACH ROW EXECUTE FUNCTION platform.reject_knowledge_history_mutation();

ALTER TABLE platform.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.knowledge_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.knowledge_chunks FORCE ROW LEVEL SECURITY;

CREATE POLICY knowledge_documents_select
  ON platform.knowledge_documents
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY knowledge_documents_insert
  ON platform.knowledge_documents
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY knowledge_chunks_select
  ON platform.knowledge_chunks
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY knowledge_chunks_insert
  ON platform.knowledge_chunks
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
