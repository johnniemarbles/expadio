\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'Execution Artifact A'),
  ('e2000000-0000-4000-8000-000000000002', 'Execution Artifact B');

SELECT set_config(
  'app.tenant_id',
  'e1000000-0000-4000-8000-000000000001',
  false
);

INSERT INTO platform.execution_artifacts (
  artifact_id, tenant_id, artifact_kind, source_kind, source_id,
  storage_reference, content_sha256, media_type, byte_length,
  provider_key, connector_key, model_key, capability_key,
  cost_minor_units, provider_cost_ownership, correlation_id
) VALUES (
  'e1000000-0000-4000-8000-000000000011',
  'e1000000-0000-4000-8000-000000000001',
  'AI_TEXT', 'AI_INVOCATION', 'ai-job:e1',
  'object://tenant-a/ai/e1.txt',
  repeat('a', 64),
  'text/plain', 12,
  'openai', 'openai-a', 'gpt-test', 'ai.generate',
  7, 'BYOK', 'corr-a'
);

DO $$
BEGIN
  BEGIN
    UPDATE platform.execution_artifacts
       SET storage_reference = 'object://tampered'
     WHERE artifact_id = 'e1000000-0000-4000-8000-000000000011';
    RAISE EXCEPTION 'execution artifact mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'execution artifact mutation unexpectedly succeeded' THEN
      RAISE;
    END IF;
    IF POSITION('Execution artifacts are append-only' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_execution_artifact_smoke;
CREATE ROLE expadio_execution_artifact_smoke NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_execution_artifact_smoke;
GRANT SELECT, INSERT ON platform.execution_artifacts
TO expadio_execution_artifact_smoke;

SET ROLE expadio_execution_artifact_smoke;
SELECT set_config(
  'app.tenant_id',
  'e1000000-0000-4000-8000-000000000001',
  false
);

DO $$
DECLARE
  visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count
    FROM platform.execution_artifacts;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one visible execution artifact, got %',
      visible_count;
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.execution_artifacts (
      tenant_id, artifact_kind, source_kind, source_id,
      storage_reference, content_sha256, media_type, byte_length,
      provider_key, connector_key, capability_key,
      cost_minor_units, provider_cost_ownership
    ) VALUES (
      'e2000000-0000-4000-8000-000000000002',
      'AI_TEXT', 'AI_INVOCATION', 'cross-tenant',
      'object://tenant-b/ai/cross.txt',
      repeat('b', 64),
      'text/plain', 12,
      'openai', 'openai-b', 'ai.generate',
      9, 'EXPADIO_MANAGED'
    );
    RAISE EXCEPTION 'cross-tenant execution artifact insert unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-tenant execution artifact insert unexpectedly succeeded' THEN
      RAISE;
    END IF;
    IF POSITION('row-level security' IN lower(SQLERRM)) = 0 THEN
      RAISE;
    END IF;
  END;
END;
$$;

RESET ROLE;

SELECT 'execution artifact convergence smoke: ok' AS result;
