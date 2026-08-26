BEGIN;

CREATE TABLE platform.object_storage_operations (
  operation_id uuid PRIMARY KEY,
  request_id text NOT NULL CHECK (btrim(request_id) <> ''),
  tenant_id uuid NOT NULL
    REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  requested_by_subject_id text NOT NULL
    CHECK (btrim(requested_by_subject_id) <> ''),
  operation text NOT NULL CHECK (
    operation IN ('STORE', 'READ', 'DELETE')
  ),
  purpose text NOT NULL CHECK (btrim(purpose) <> ''),
  object_reference text NOT NULL
    CHECK (btrim(object_reference) <> ''),
  source_reference text,
  expected_sha256 text CHECK (
    expected_sha256 IS NULL
    OR expected_sha256 ~ '^[0-9a-fA-F]{64}$'
  ),
  content_type text,
  retention_policy_key text NOT NULL
    CHECK (btrim(retention_policy_key) <> ''),
  retention_policy_version integer NOT NULL
    CHECK (retention_policy_version > 0),
  required_residency_tags text[] NOT NULL CHECK (
    cardinality(required_residency_tags) > 0
    AND array_position(required_residency_tags, NULL) IS NULL
  ),
  required_compliance_tags text[] NOT NULL CHECK (
    array_position(required_compliance_tags, NULL) IS NULL
  ),
  deletion_authorization_decision_id text,
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  requested_at timestamptz NOT NULL,
  status text NOT NULL CHECK (
    status IN ('STORED', 'AVAILABLE', 'DELETED')
  ),
  content_reference text,
  actual_sha256 text CHECK (
    actual_sha256 IS NULL
    OR actual_sha256 ~ '^[0-9a-fA-F]{64}$'
  ),
  connector_key text NOT NULL CHECK (btrim(connector_key) <> ''),
  provider_key text NOT NULL CHECK (btrim(provider_key) <> ''),
  region text NOT NULL CHECK (btrim(region) <> ''),
  completed_at timestamptz NOT NULL,
  correlation_id uuid NOT NULL,
  evidence_refs text[] NOT NULL CHECK (
    cardinality(evidence_refs) > 0
    AND array_position(evidence_refs, NULL) IS NULL
  ),
  source_references text[] NOT NULL CHECK (
    cardinality(source_references) > 0
    AND array_position(source_references, NULL) IS NULL
  ),
  UNIQUE (tenant_id, request_id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (completed_at >= requested_at),
  CHECK (
    (operation = 'STORE'
      AND status = 'STORED'
      AND btrim(source_reference) <> ''
      AND expected_sha256 IS NOT NULL
      AND actual_sha256 = expected_sha256
      AND btrim(content_reference) <> ''
      AND deletion_authorization_decision_id IS NULL)
    OR (operation = 'READ'
      AND status = 'AVAILABLE'
      AND btrim(content_reference) <> ''
      AND actual_sha256 IS NOT NULL
      AND deletion_authorization_decision_id IS NULL)
    OR (operation = 'DELETE'
      AND status = 'DELETED'
      AND btrim(deletion_authorization_decision_id) <> ''
      AND content_reference IS NULL
      AND actual_sha256 IS NULL)
  )
);

CREATE INDEX object_storage_operations_object_idx
  ON platform.object_storage_operations (
    tenant_id, object_reference, completed_at DESC
  );

CREATE INDEX object_storage_operations_provider_idx
  ON platform.object_storage_operations (
    tenant_id, connector_key, completed_at DESC
  );

CREATE OR REPLACE FUNCTION platform.reject_storage_operation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Object storage operation history is immutable';
END;
$$;

CREATE TRIGGER object_storage_operations_immutable
BEFORE UPDATE OR DELETE ON platform.object_storage_operations
FOR EACH ROW EXECUTE FUNCTION platform.reject_storage_operation_mutation();

ALTER TABLE platform.object_storage_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.object_storage_operations FORCE ROW LEVEL SECURITY;

CREATE POLICY object_storage_operations_select
  ON platform.object_storage_operations
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY object_storage_operations_insert
  ON platform.object_storage_operations
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
