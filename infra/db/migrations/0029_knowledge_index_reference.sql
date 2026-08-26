BEGIN;

ALTER TABLE platform.knowledge_documents
  ADD COLUMN index_reference text;

UPDATE platform.knowledge_documents
   SET index_reference = source_reference
 WHERE index_reference IS NULL;

ALTER TABLE platform.knowledge_documents
  ALTER COLUMN index_reference SET NOT NULL,
  ADD CONSTRAINT knowledge_documents_index_reference_nonblank
    CHECK (btrim(index_reference) <> '');

COMMIT;
