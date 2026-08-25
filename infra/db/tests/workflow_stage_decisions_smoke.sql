\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('51515151-5151-5151-5151-515151515151', 'Decision Tenant A'),
  ('52525252-5252-5252-5252-525252525252', 'Decision Tenant B');

INSERT INTO platform.workflow_instances (
  instance_id, tenant_id, work_type_key, subject_type, subject_id,
  blueprint_key, blueprint_version, blueprint_scope, state,
  current_stage_key, revision, created_at, started_at, updated_at
) VALUES
  (
    '51510000-0000-0000-0000-000000000001',
    '51515151-5151-5151-5151-515151515151',
    'partner-onboarding', 'LEAD', 'lead-a',
    'partner-onboarding', 1, 'PLATFORM', 'RUNNING',
    'decision', 1, now(), now(), now()
  ),
  (
    '52520000-0000-0000-0000-000000000001',
    '52525252-5252-5252-5252-525252525252',
    'partner-onboarding', 'LEAD', 'lead-b',
    'partner-onboarding', 1, 'PLATFORM', 'RUNNING',
    'decision', 1, now(), now(), now()
  );

INSERT INTO platform.workflow_stage_decisions (
  decision_id, tenant_id, instance_id, work_type_key, stage_key,
  outcome, decided_by_subject_id, decided_at, code, evidence_refs
) VALUES (
  'decision-a-1',
  '51515151-5151-5151-5151-515151515151',
  '51510000-0000-0000-0000-000000000001',
  'partner-onboarding', 'decision', 'APPROVED', 'subject-a', now(),
  'APPROVED_BY_AUTHORITY', ARRAY['approval:a']
);

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.workflow_stage_decisions (
      decision_id, tenant_id, instance_id, work_type_key, stage_key,
      outcome, decided_by_subject_id, decided_at, code
    ) VALUES (
      'decision-a-2',
      '51515151-5151-5151-5151-515151515151',
      '51510000-0000-0000-0000-000000000001',
      'partner-onboarding', 'decision', 'REJECTED', 'subject-a', now(),
      'SECOND_DECISION'
    );
    RAISE EXCEPTION 'second stage decision unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  BEGIN
    UPDATE platform.workflow_stage_decisions
       SET outcome = 'REJECTED'
     WHERE decision_id = 'decision-a-1';
    RAISE EXCEPTION 'workflow stage decision update unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'workflow stage decisions are immutable' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM platform.workflow_stage_decisions
     WHERE decision_id = 'decision-a-1';
    RAISE EXCEPTION 'workflow stage decision delete unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'workflow stage decisions are immutable' THEN RAISE; END IF;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_workflow_decision_test;
CREATE ROLE expadio_workflow_decision_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_workflow_decision_test;
GRANT SELECT, INSERT ON platform.workflow_stage_decisions TO expadio_workflow_decision_test;

SET ROLE expadio_workflow_decision_test;
SELECT set_config('app.tenant_id', '51515151-5151-5151-5151-515151515151', false);

DO $$
DECLARE
  visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM platform.workflow_stage_decisions;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one visible decision, got %', visible_count;
  END IF;

  BEGIN
    INSERT INTO platform.workflow_stage_decisions (
      decision_id, tenant_id, instance_id, work_type_key, stage_key,
      outcome, decided_by_subject_id, decided_at, code
    ) VALUES (
      'decision-b-forbidden',
      '52525252-5252-5252-5252-525252525252',
      '52520000-0000-0000-0000-000000000001',
      'partner-onboarding', 'decision', 'APPROVED', 'subject-a', now(),
      'FORBIDDEN_CROSS_TENANT'
    );
    RAISE EXCEPTION 'cross-tenant decision insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

SELECT 'workflow stage decisions smoke: ok' AS result;
