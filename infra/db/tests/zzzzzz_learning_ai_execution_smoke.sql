\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1', 'AI Runtime Smoke A'),
  ('d2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2', 'AI Runtime Smoke B');

INSERT INTO platform.ai_jobs (
  job_id, tenant_id, invocation_id, operation, purpose,
  input_reference, context_reference,
  prompt_configuration_key, prompt_configuration_version,
  required_residency_tags, required_compliance_tags,
  maximum_cost_minor_units, maximum_attempts, idempotency_key,
  requested_at, created_by_subject_id, created_at, reason,
  correlation_id, evidence_refs
) VALUES
  (
    'c1000000-0000-4000-8000-000000000001',
    'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1',
    'learning:smoke-a', 'GENERATE', 'Learning AI smoke A.',
    'ai-artifact://c1000000-0000-4000-8000-000000000011', NULL,
    'prompt.learning.tutor', 1,
    ARRAY[]::text[], ARRAY[]::text[], 25, 3,
    'learning:tutor:smoke-a',
    now(), 'learner-a', now(), 'Queue Learning AI smoke A.',
    'c1000000-0000-4000-8000-000000000101',
    ARRAY['learning://smoke/a']
  ),
  (
    'd2000000-0000-4000-8000-000000000001',
    'd2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2',
    'learning:smoke-b', 'GENERATE', 'Learning AI smoke B.',
    'ai-artifact://d2000000-0000-4000-8000-000000000011', NULL,
    'prompt.learning.tutor', 1,
    ARRAY[]::text[], ARRAY[]::text[], 25, 3,
    'learning:tutor:smoke-b',
    now(), 'learner-b', now(), 'Queue Learning AI smoke B.',
    'd2000000-0000-4000-8000-000000000101',
    ARRAY['learning://smoke/b']
  );

INSERT INTO platform.ai_job_artifacts (
  artifact_id, tenant_id, job_id, artifact_type, content,
  metadata, created_by_subject_id
) VALUES
  (
    'c1000000-0000-4000-8000-000000000011',
    'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1',
    'c1000000-0000-4000-8000-000000000001',
    'INPUT',
    'Tenant A private learner question.',
    '{"source":"learning.tutor"}'::jsonb,
    'learner-a'
  ),
  (
    'd2000000-0000-4000-8000-000000000011',
    'd2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2',
    'd2000000-0000-4000-8000-000000000001',
    'INPUT',
    'Tenant B private learner question.',
    '{"source":"learning.tutor"}'::jsonb,
    'learner-b'
  );

INSERT INTO platform.ai_job_execution_queue (tenant_id, job_id) VALUES
  (
    'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1',
    'c1000000-0000-4000-8000-000000000001'
  ),
  (
    'd2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2',
    'd2000000-0000-4000-8000-000000000001'
  );

INSERT INTO platform.learning_ai_requests (
  learning_ai_request_id, tenant_id, job_id, request_type,
  requested_by_subject_id, prompt_key, prompt_version,
  input_artifact_id, correlation_id, metadata
) VALUES
  (
    'c1000000-0000-4000-8000-000000000021',
    'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1',
    'c1000000-0000-4000-8000-000000000001',
    'TUTOR', 'learner-a', 'prompt.learning.tutor', 1,
    'c1000000-0000-4000-8000-000000000011',
    'c1000000-0000-4000-8000-000000000101',
    '{"surface":"learner"}'::jsonb
  ),
  (
    'd2000000-0000-4000-8000-000000000021',
    'd2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2',
    'd2000000-0000-4000-8000-000000000001',
    'TUTOR', 'learner-b', 'prompt.learning.tutor', 1,
    'd2000000-0000-4000-8000-000000000011',
    'd2000000-0000-4000-8000-000000000101',
    '{"surface":"learner"}'::jsonb
  );

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.ai_job_artifacts (
      tenant_id, job_id, artifact_type, content,
      metadata, created_by_subject_id
    ) VALUES (
      'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1',
      'c1000000-0000-4000-8000-000000000001',
      'OUTPUT',
      'must not be stored in the job artifact table',
      '{}'::jsonb,
      'ai-worker'
    );
    RAISE EXCEPTION 'AI OUTPUT job artifact unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    UPDATE platform.ai_job_artifacts
       SET content = 'mutated'
     WHERE artifact_id = 'c1000000-0000-4000-8000-000000000011';
    RAISE EXCEPTION 'AI artifact mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'AI artifact mutation unexpectedly succeeded' THEN
      RAISE;
    END IF;
    IF POSITION('AI job artifacts are immutable' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;

  BEGIN
    DELETE FROM platform.learning_ai_requests
     WHERE learning_ai_request_id =
       'c1000000-0000-4000-8000-000000000021';
    RAISE EXCEPTION 'Learning AI linkage delete unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Learning AI linkage delete unexpectedly succeeded' THEN
      RAISE;
    END IF;
    IF POSITION('Learning AI request linkage is immutable' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_learning_ai_smoke;
CREATE ROLE expadio_learning_ai_smoke NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_learning_ai_smoke;
GRANT SELECT ON
  platform.ai_jobs,
  platform.ai_job_events,
  platform.ai_job_artifacts,
  platform.ai_job_execution_queue,
  platform.learning_ai_requests
TO expadio_learning_ai_smoke;

SET ROLE expadio_learning_ai_smoke;
SELECT set_config(
  'app.tenant_id',
  'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1',
  false
);

DO $$
DECLARE
  artifact_count integer;
  queue_count integer;
  request_count integer;
  visible_content text;
BEGIN
  SELECT count(*), max(content)
    INTO artifact_count, visible_content
    FROM platform.ai_job_artifacts;
  SELECT count(*) INTO queue_count
    FROM platform.ai_job_execution_queue;
  SELECT count(*) INTO request_count
    FROM platform.learning_ai_requests;

  IF artifact_count <> 1 OR queue_count <> 1 OR request_count <> 1 THEN
    RAISE EXCEPTION
      'tenant A expected one artifact/queue/request, got %/%/%',
      artifact_count, queue_count, request_count;
  END IF;

  IF visible_content <> 'Tenant A private learner question.' THEN
    RAISE EXCEPTION 'tenant A saw unexpected AI artifact content';
  END IF;
END;
$$;

RESET ROLE;

SELECT 'learning AI execution smoke: ok' AS result;
