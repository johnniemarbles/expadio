BEGIN;

ALTER TABLE platform.knowledge_documents
  ADD COLUMN ingestion_id text,
  ADD COLUMN purpose text,
  ADD COLUMN requested_at timestamptz;

UPDATE platform.knowledge_documents
   SET ingestion_id = authorization_decision_id,
       purpose = reason,
       requested_at = indexed_at
 WHERE ingestion_id IS NULL
    OR purpose IS NULL
    OR requested_at IS NULL;

ALTER TABLE platform.knowledge_documents
  ALTER COLUMN ingestion_id SET NOT NULL,
  ALTER COLUMN purpose SET NOT NULL,
  ALTER COLUMN requested_at SET NOT NULL,
  ADD CONSTRAINT knowledge_documents_ingestion_id_nonblank
    CHECK (btrim(ingestion_id) <> ''),
  ADD CONSTRAINT knowledge_documents_purpose_nonblank
    CHECK (btrim(purpose) <> ''),
  ADD CONSTRAINT knowledge_documents_request_before_index
    CHECK (requested_at <= indexed_at);

CREATE UNIQUE INDEX knowledge_documents_ingestion_uq
  ON platform.knowledge_documents (tenant_id, ingestion_id);

COMMIT;
