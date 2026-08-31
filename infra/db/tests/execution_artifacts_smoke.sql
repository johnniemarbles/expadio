\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('9a111111-1111-4111-8111-111111111111', 'Execution Artifact Tenant A'),
  ('9b222222-2222-4222-8222-222222222222', 'Execution Artifact Tenant B');

INSERT INTO platform.execution_artifacts (
  artifact_id, tenant_id, artifact_kind, source_kind, source_id,
  storage_reference, content_sha256, media_type, byte_length,
  provider_key, connector_key, model_key, correlation_id
) VALUES
  (
    '9c111111-1111-4111-8111-111111111111',
    '9a111111-1111-4111-8111-111111111111',
    'AI_TEXT', 'AI_INVOCATION', 'inv-tenant-a',
    'storage://tenant-a/ai/inv-tenant-a.txt',
    repeat('a', 64), 'text/plain', 12,
    'openai', 'connector.ai.openai.us', 'gpt-4o-mini', 'corr-a'
  ),
  (
    '9c222222-2222-4222-8222-222222222222',
    '9b222222-2222-4222-8222-222222222222',
    'VOICE_TRANSCRIPT', 'VOICE_REQUEST', 'voice-tenant-b',
    'storage://tenant-b/voice/voice-tenant-b.txt',
    repeat('b', 64), 'text/plain', 20,
    'deepgram', 'connector.voice.deepgram.us', 'nova-2', 'corr-b'
  );

DROP ROLE IF EXISTS expadio_execution_artifacts_test;
CREATE ROLE expadio_execution_artifacts_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_execution_artifacts_test;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform.execution_artifacts
  TO expadio_execution_artifacts_test;

SET ROLE expadio_execution_artifacts_test;
SELECT set_config(
  'app.tenant_id',
  '9a111111-1111-4111-8111-111111111111',
  false
);

DO $$
DECLARE
  artifact_count integer;
BEGIN
  SELECT count(*) INTO artifact_count
    FROM platform.execution_artifacts;
  IF artifact_count <> 1 THEN
    RAISE EXCEPTION 'tenant A can see another tenant execution artifact';
  END IF;
END;
$$;

INSERT INTO platform.execution_artifacts (
  artifact_id, tenant_id, artifact_kind, source_kind, source_id,
  storage_reference, content_sha256, media_type, byte_length,
  provider_key, connector_key
) VALUES (
  '9c333333-3333-4333-8333-333333333333',
  '9a111111-1111-4111-8111-111111111111',
  'AI_EMBEDDING', 'AI_INVOCATION', 'embed-tenant-a',
  'storage://tenant-a/ai/embed-tenant-a.json',
  repeat('c', 64), 'application/json', 128,
  'openai', 'connector.ai.openai.us'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.execution_artifacts (
      artifact_id, tenant_id, artifact_kind, source_kind, source_id,
      storage_reference, content_sha256, media_type, byte_length,
      provider_key, connector_key
    ) VALUES (
      '9c444444-4444-4444-8444-444444444444',
      '9b222222-2222-4222-8222-222222222222',
      'AI_TEXT', 'AI_INVOCATION', 'cross-tenant',
      'storage://tenant-b/ai/cross-tenant.txt',
      repeat('d', 64), 'text/plain', 1,
      'openai', 'connector.ai.openai.us'
    );
    RAISE EXCEPTION 'cross-tenant execution artifact insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  changed_count integer;
BEGIN
  UPDATE platform.execution_artifacts
     SET media_type = 'application/octet-stream'
   WHERE artifact_id = '9c111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'tenant execution artifact update unexpectedly succeeded';
  END IF;

  DELETE FROM platform.execution_artifacts
   WHERE artifact_id = '9c111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'tenant execution artifact delete unexpectedly succeeded';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.execution_artifacts (
      artifact_id, tenant_id, artifact_kind, source_kind, source_id,
      storage_reference, content_sha256, media_type, byte_length,
      provider_key, connector_key
    ) VALUES (
      '9c555555-5555-4555-8555-555555555555',
      '9a111111-1111-4111-8111-111111111111',
      'AI_EMBEDDING', 'AI_INVOCATION', 'embed-tenant-a',
      'storage://tenant-a/ai/embed-tenant-a-replay.json',
      repeat('e', 64), 'application/json', 129,
      'openai', 'connector.ai.openai.us'
    );
    RAISE EXCEPTION 'duplicate execution artifact replay identity unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    UPDATE platform.execution_artifacts
       SET media_type = 'application/octet-stream'
     WHERE artifact_id = '9c111111-1111-4111-8111-111111111111';
    RAISE EXCEPTION 'privileged execution artifact update unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'Execution artifacts are append-only%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    DELETE FROM platform.execution_artifacts
     WHERE artifact_id = '9c111111-1111-4111-8111-111111111111';
    RAISE EXCEPTION 'privileged execution artifact delete unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'Execution artifacts are append-only%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

SELECT 'Execution artifacts smoke: ok' AS result;
