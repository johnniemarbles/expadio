\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('a6161616-1616-1616-1616-161616161616', 'Workflow Instance Tenant A'),
  ('b6262626-2626-2626-2626-262626262626', 'Workflow Instance Tenant B');

INSERT INTO platform.workflow_instances (
  instance_id, tenant_id, work_type_key, subject_type, subject_id,
  blueprint_key, blueprint_version, blueprint_scope, state,
  current_stage_key, revision, created_at, started_at, updated_at
) VALUES
  (
    'a6160000-0000-0000-0000-000000000001',
    'a6161616-1616-1616-1616-161616161616',
    'partner-onboarding', 'PARTNER', 'partner-a',
    'partner-onboarding', 2, 'TENANT', 'RUNNING',
    'qualification', 0, now(), now(), now()
  ),
  (
    'b6260000-0000-0000-0000-000000000001',
    'b6262626-2626-2626-2626-262626262626',
    'partner-onboarding', 'PARTNER', 'partner-b',
    'partner-onboarding', 1, 'PLATFORM', 'RUNNING',
    'qualification', 0, now(), now(), now()
  );

INSERT INTO platform.workflow_instance_transitions (
  transition_id, instance_id, tenant_id, from_stage_key, to_stage_key,
  from_state, to_state, revision, transitioned_by_subject_id, transitioned_at, reason
) VALUES (
  'a6160000-0000-0000-0000-000000000101',
  'a6160000-0000-0000-0000-000000000001',
  'a6161616-1616-1616-1616-161616161616',
  'qualification', 'review', 'RUNNING', 'RUNNING', 1,
  'subject-a', now(), 'qualification complete'
);

DO $$
BEGIN
  BEGIN
    UPDATE platform.workflow_instance_transitions
       SET reason = 'mutated'
     WHERE transition_id = 'a6160000-0000-0000-0000-000000000101';
    RAISE EXCEPTION 'workflow transition mutation unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'workflow instance transitions are append-only' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_workflow_instance_test;
CREATE ROLE expadio_workflow_instance_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_workflow_instance_test;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.workflow_instances TO expadio_workflow_instance_test;
GRANT SELECT, INSERT ON platform.workflow_instance_transitions TO expadio_workflow_instance_test;

SET ROLE expadio_workflow_instance_test;
SELECT set_config('app.tenant_id', 'a6161616-1616-1616-1616-161616161616', false);

DO $$
DECLARE
  instance_count integer;
  transition_count integer;
BEGIN
  SELECT count(*) INTO instance_count FROM platform.workflow_instances;
  SELECT count(*) INTO transition_count FROM platform.workflow_instance_transitions;

  IF instance_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected 1 visible workflow instance, got %', instance_count;
  END IF;
  IF transition_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected 1 visible workflow transition, got %', transition_count;
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.workflow_instances (
      instance_id, tenant_id, work_type_key, subject_type, subject_id,
      blueprint_key, blueprint_version, blueprint_scope, state,
      revision, created_at, updated_at
    ) VALUES (
      'b6260000-0000-0000-0000-000000000002',
      'b6262626-2626-2626-2626-262626262626',
      'cross-tenant', 'PARTNER', 'forbidden',
      'partner-onboarding', 1, 'PLATFORM', 'CREATED',
      0, now(), now()
    );
    RAISE EXCEPTION 'cross-tenant workflow instance insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

INSERT INTO platform.workflow_instance_transitions (
  instance_id, tenant_id, from_stage_key, to_stage_key,
  from_state, to_state, revision, transitioned_by_subject_id, transitioned_at
) VALUES (
  'a6160000-0000-0000-0000-000000000001',
  'a6161616-1616-1616-1616-161616161616',
  'review', 'decision', 'RUNNING', 'RUNNING', 2,
  'subject-a', now()
);

RESET ROLE;

SELECT 'workflow instances smoke: ok' AS result;
