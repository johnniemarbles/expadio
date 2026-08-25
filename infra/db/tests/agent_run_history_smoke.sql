\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('9d6e3f40-a12b-4c53-d4e5-f60718293a4b', 'Agent Run Tenant A'),
  ('ae7f4051-b23c-4d64-e5f6-0718293a4b5c', 'Agent Run Tenant B');

INSERT INTO platform.agent_runs (
  run_id, tenant_id, agent_id, purpose,
  context_bundle_reference, budget_policy_reference,
  idempotency_key, requested_by_subject_id,
  requested_at, created_at, reason, correlation_id, evidence_refs
) VALUES
  (
    'b0000000-0000-0000-0000-000000000001',
    '9d6e3f40-a12b-4c53-d4e5-f60718293a4b',
    'agent-a', 'Prepare an authorized account proposal.',
    'context://tenant-a/bundle-1', 'policy://agent-budget/v1',
    'agent-run:a:1', 'subject-a',
    '2026-08-25T20:00:00Z', now(), 'Start governed agent run.',
    'b0000000-0000-0000-0000-000000000101',
    ARRAY['request://agent-run/a']
  ),
  (
    'b0000000-0000-0000-0000-000000000002',
    'ae7f4051-b23c-4d64-e5f6-0718293a4b5c',
    'agent-b', 'Prepare a tenant B proposal.',
    'context://tenant-b/bundle-1', 'policy://agent-budget/v1',
    'agent-run:b:1', 'subject-b',
    '2026-08-25T20:00:00Z', now(), 'Start governed agent run.',
    'b0000000-0000-0000-0000-000000000102',
    ARRAY['request://agent-run/b']
  );

INSERT INTO platform.agent_run_events (
  event_id, run_id, tenant_id, sequence, event_type,
  event_reference, occurred_at, actor_subject_id, reason,
  correlation_id, evidence_refs, cost_minor_units
) VALUES (
  'b0000000-0000-0000-0000-000000000011',
  'b0000000-0000-0000-0000-000000000002',
  'ae7f4051-b23c-4d64-e5f6-0718293a4b5c',
  1, 'STARTED', 'event://agent-run/b/started',
  now(), 'subject-b', 'Agent run started.',
  'b0000000-0000-0000-0000-000000000112',
  ARRAY['request://agent-run/b'], NULL
);

DROP ROLE IF EXISTS expadio_agent_runs_test;
CREATE ROLE expadio_agent_runs_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_agent_runs_test;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform.agent_runs, platform.agent_run_events
  TO expadio_agent_runs_test;

SET ROLE expadio_agent_runs_test;
SELECT set_config(
  'app.tenant_id',
  '9d6e3f40-a12b-4c53-d4e5-f60718293a4b',
  false
);

DO $$
DECLARE
  run_count integer;
  event_count integer;
BEGIN
  SELECT count(*) INTO run_count FROM platform.agent_runs;
  SELECT count(*) INTO event_count FROM platform.agent_run_events;
  IF run_count <> 1 OR event_count <> 0 THEN
    RAISE EXCEPTION 'tenant A can see another tenant agent run history';
  END IF;
END;
$$;

INSERT INTO platform.agent_run_events (
  event_id, run_id, tenant_id, sequence, event_type,
  event_reference, occurred_at, actor_subject_id, reason,
  correlation_id, evidence_refs, cost_minor_units
) VALUES (
  'b0000000-0000-0000-0000-000000000012',
  'b0000000-0000-0000-0000-000000000001',
  '9d6e3f40-a12b-4c53-d4e5-f60718293a4b',
  1, 'BUDGET_RESERVED', 'budget://reservation/a/1',
  now(), 'subject-a', 'Reserved governed tool budget.',
  'b0000000-0000-0000-0000-000000000113',
  ARRAY['policy://agent-budget/v1'], 7
);

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.agent_run_events (
      event_id, run_id, tenant_id, sequence, event_type,
      event_reference, occurred_at, actor_subject_id, reason,
      correlation_id, evidence_refs
    ) VALUES (
      'b0000000-0000-0000-0000-000000000013',
      'b0000000-0000-0000-0000-000000000001',
      '9d6e3f40-a12b-4c53-d4e5-f60718293a4b',
      3, 'SUCCEEDED', 'output://agent-run/a/1',
      now(), 'subject-a', 'Invalid sequence.',
      'b0000000-0000-0000-0000-000000000114',
      ARRAY['negative:test']
    );
    RAISE EXCEPTION 'out-of-sequence agent event unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE
        'Agent run event sequence must be 2, received 3%'
      THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.agent_runs (
      run_id, tenant_id, agent_id, purpose,
      context_bundle_reference, budget_policy_reference,
      idempotency_key, requested_by_subject_id,
      requested_at, created_at, reason, correlation_id, evidence_refs
    ) VALUES (
      'b0000000-0000-0000-0000-000000000003',
      'ae7f4051-b23c-4d64-e5f6-0718293a4b5c',
      'agent-cross', 'Cross tenant run.',
      'context://tenant-b/cross', 'policy://agent-budget/v1',
      'agent-run:cross:1', 'subject-a',
      now(), now(), 'Cross tenant insert.',
      'b0000000-0000-0000-0000-000000000115',
      ARRAY['negative:test']
    );
    RAISE EXCEPTION 'cross-tenant agent run insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  changed_count integer;
BEGIN
  UPDATE platform.agent_runs
     SET purpose = 'Mutated'
   WHERE run_id = 'b0000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'tenant agent run mutation unexpectedly changed history';
  END IF;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    UPDATE platform.agent_run_events
       SET reason = 'Mutated'
     WHERE event_id = 'b0000000-0000-0000-0000-000000000011';
    RAISE EXCEPTION 'privileged agent event mutation unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'Agent run history is immutable%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

SELECT 'Agent run history smoke: ok' AS result;
