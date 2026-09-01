BEGIN;

CREATE TABLE platform.execution_artifacts (
  artifact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE RESTRICT,
  artifact_kind text NOT NULL CHECK (artifact_kind IN (
    'AI_TEXT',
    'AI_EMBEDDING',
    'VOICE_TRANSCRIPT',
    'VOICE_AUDIO'
  )),
  source_kind text NOT NULL CHECK (source_kind IN ('AI_INVOCATION', 'VOICE_REQUEST')),
  source_id text NOT NULL CHECK (btrim(source_id) <> ''),
  storage_reference text NOT NULL CHECK (btrim(storage_reference) <> ''),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  media_type text NOT NULL CHECK (btrim(media_type) <> ''),
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  provider_key text NOT NULL CHECK (btrim(provider_key) <> ''),
  connector_key text NOT NULL CHECK (btrim(connector_key) <> ''),
  model_key text NULL CHECK (model_key IS NULL OR btrim(model_key) <> ''),
  capability_key text NOT NULL CHECK (btrim(capability_key) <> ''),
  cost_minor_units bigint NOT NULL DEFAULT 0 CHECK (cost_minor_units >= 0),
  provider_cost_ownership text NOT NULL CHECK (
    provider_cost_ownership IN ('BYOK','EXPADIO_MANAGED')
  ),
  confidence numeric NULL CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  ),
  correlation_id text NULL CHECK (correlation_id IS NULL OR btrim(correlation_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, artifact_kind, source_kind, source_id)
);

CREATE INDEX execution_artifacts_source_idx
  ON platform.execution_artifacts (tenant_id, source_kind, source_id, created_at DESC);

CREATE INDEX execution_artifacts_created_idx
  ON platform.execution_artifacts (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION platform.reject_execution_artifact_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Execution artifacts are append-only';
END;
$$;

CREATE TRIGGER execution_artifacts_immutable
BEFORE UPDATE OR DELETE ON platform.execution_artifacts
FOR EACH ROW EXECUTE FUNCTION platform.reject_execution_artifact_mutation();

ALTER TABLE platform.execution_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.execution_artifacts FORCE ROW LEVEL SECURITY;

CREATE POLICY execution_artifacts_tenant_select
  ON platform.execution_artifacts
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY execution_artifacts_tenant_insert
  ON platform.execution_artifacts
  FOR INSERT WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
