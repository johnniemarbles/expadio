\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'AI Job Tenant A'),
  ('a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2', 'AI Job Tenant B');

INSERT INTO platform.ai_jobs (
  job_id, tenant_id, invocation_id, operation, purpose,
  input_reference, context_reference,
  prompt_configuration_key, prompt_configuration_version,
  required_residency_tags, required_compliance_tags,
  maximum_cost_minor_units, maximum_attempts, idempotency_key,
  created_by_subject_id, created_at, reason, correlation_id, evidence_refs
) VALUES
  (
    'a0000000-0000-0000-0000-000000000001',
    'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
    'invocation-a', 'EXTRACT', 'Extract facts for review.',
    'object://tenant-a/document-1', NULL,
    'extract-facts', 1, ARRAY['eu'], ARRAY['regulated'],
    20, 2, 'extract:document-1:v1',
    'worker-a', now(), 'Queue extraction.',
    'a0000000-0000-0000-0000-000000000101',
    ARRAY['queue:message-a']
  ),
  (
    'a0000000-0000-0000-0000-000000000002',
    'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2',
    'invocation-b', 'SUMMARIZE', 'Summarize call for review.',
    'object://tenant-b/call-1', NULL,
    'call-summary', 1, ARRAY['us'], ARRAY['regulated'],
    10, 2, 'summarize:call-1:v1',
    'worker-b', now(), 'Queue summary.',
    'a0000000-0000-0000-0000-000000000102',
    ARRAY['queue:message-b']
  );

INSERT INTO platform.ai_job_events (
  event_id, job_id, tenant_id, sequence, event_type, occurred_at,
  actor_subject_id, reason, correlation_id, evidence_refs
) VALUES
  (
    'a0000000-0000-0000-0000-000000000011',
    'a0000000-0000-0000-0000-000000000002',
    'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2',
    1, 'STARTED', now(), 'worker-b', 'Start summary.',
    'a0000000-0000-0000-0000-000000000112',
    ARRAY['worker:lease-b']
  );

DROP ROLE IF EXISTS expadio_ai_jobs_test;
CREATE ROLE expadio_ai_jobs_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_ai_jobs_test;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform.ai_jobs, platform.ai_job_events
  TO expadio_ai_jobs_test;

SET ROLE expadio_ai_jobs_test;
SELECT set_config(
  'app.tenant_id',
  'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
  false
);

DO $$
DECLARE
  job_count integer;
  event_count integer;
BEGIN
  SELECT count(*) INTO job_count FROM platform.ai_jobs;
  SELECT count(*) INTO event_count FROM platform.ai_job_events;
  IF job_count <> 1 OR event_count <> 0 THEN
    RAISE EXCEPTION 'tenant A can see another tenant AI job history';
  END IF;
END;
$$;

INSERT INTO platform.ai_job_events (
  event_id, job_id, tenant_id, sequence, event_type, occurred_at,
  actor_subject_id, reason, correlation_id, evidence_refs
) VALUES (
  'a0000000-0000-0000-0000-000000000012',
  'a0000000-0000-0000-0000-000000000001',
  'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
  1, 'STARTED', now(), 'worker-a', 'Start extraction.',
  'a0000000-0000-0000-0000-000000000113',
  ARRAY['worker:lease-a']
);

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.ai_job_events (
      event_id, job_id, tenant_id, sequence, event_type, occurred_at,
      actor_subject_id, reason, correlation_id, evidence_refs
    ) VALUES (
      'a0000000-0000-0000-0000-000000000013',
      'a0000000-0000-0000-0000-000000000001',
      'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1',
      3, 'CANCELLED', now(), 'worker-a', 'Invalid sequence.',
      'a0000000-0000-0000-0000-000000000114',
      ARRAY['worker:lease-a']
    );
    RAISE EXCEPTION 'out-of-sequence AI event unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'AI job event sequence must be 2, received 3%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.ai_jobs (
      job_id, tenant_id, invocation_id, operation, purpose,
      input_reference, prompt_configuration_key,
      prompt_configuration_version, required_residency_tags,
      required_compliance_tags, maximum_attempts, idempotency_key,
      created_by_subject_id, created_at, reason, correlation_id, evidence_refs
    ) VALUES (
      'a0000000-0000-0000-0000-000000000003',
      'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2',
      'cross-tenant', 'GENERATE', 'Cross tenant.',
      'object://tenant-b/input', 'generate', 1,
      ARRAY[]::text[], ARRAY[]::text[], 1, 'cross-tenant',
      'worker-a', now(), 'Cross tenant insert.',
      'a0000000-0000-0000-0000-000000000115',
      ARRAY['negative:test']
    );
    RAISE EXCEPTION 'cross-tenant AI job insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  changed_count integer;
BEGIN
  UPDATE platform.ai_jobs
     SET purpose = 'Mutated'
   WHERE job_id = 'a0000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'tenant AI job mutation unexpectedly changed history';
  END IF;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    UPDATE platform.ai_job_events
       SET reason = 'Mutated'
     WHERE event_id = 'a0000000-0000-0000-0000-000000000011';
    RAISE EXCEPTION 'privileged AI event mutation unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'AI job history is immutable%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

SELECT 'AI jobs smoke: ok' AS result;
