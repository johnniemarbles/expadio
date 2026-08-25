\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('96969696-9696-9696-9696-969696969696', 'Rights Tenant A'),
  ('97979797-9797-9797-9797-979797979797', 'Rights Tenant B');

INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES
  ('96960000-0000-0000-0000-000000000001', '96969696-9696-9696-9696-969696969696', 'Rights Org A'),
  ('97970000-0000-0000-0000-000000000001', '97979797-9797-9797-9797-979797979797', 'Rights Org B');

INSERT INTO platform.workflow_instances (
  instance_id, tenant_id, work_type_key, subject_type, subject_id,
  blueprint_key, blueprint_version, blueprint_scope, state,
  current_stage_key, revision, created_at, updated_at
) VALUES
  (
    '96960000-0000-0000-0000-000000000010',
    '96969696-9696-9696-9696-969696969696',
    'distribution-onboarding', 'organization', 'org-a',
    'distribution-onboarding', 1, 'PLATFORM', 'RUNNING',
    'rights', 4, now(), now()
  ),
  (
    '97970000-0000-0000-0000-000000000010',
    '97979797-9797-9797-9797-979797979797',
    'distribution-onboarding', 'organization', 'org-b',
    'distribution-onboarding', 1, 'PLATFORM', 'RUNNING',
    'rights', 4, now(), now()
  );

INSERT INTO platform.workflow_rights_grants (
  grant_id, tenant_id, instance_id, work_type_key,
  beneficiary_organization_id, profile_key, profile_version,
  right_types, scope, effective_from, source_decision_id,
  granted_by_subject_id, granted_at, state, evidence_refs
) VALUES
  (
    '96960000-0000-0000-0000-000000000020',
    '96969696-9696-9696-9696-969696969696',
    '96960000-0000-0000-0000-000000000010',
    'distribution-onboarding',
    '96960000-0000-0000-0000-000000000001',
    'distribution-basic', 1,
    ARRAY['SELL'], '{"territoryIds":["north"]}'::jsonb,
    now(), 'decision-a', 'approver-a', now(), 'ACTIVE', ARRAY['decision:decision-a']
  ),
  (
    '97970000-0000-0000-0000-000000000020',
    '97979797-9797-9797-9797-979797979797',
    '97970000-0000-0000-0000-000000000010',
    'distribution-onboarding',
    '97970000-0000-0000-0000-000000000001',
    'distribution-basic', 1,
    ARRAY['SELL'], '{"territoryIds":["south"]}'::jsonb,
    now(), 'decision-b', 'approver-b', now(), 'ACTIVE', ARRAY['decision:decision-b']
  );

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.workflow_rights_grants (
      grant_id, tenant_id, instance_id, work_type_key,
      beneficiary_subject_id, beneficiary_organization_id,
      profile_key, profile_version, right_types, scope,
      effective_from, granted_by_subject_id, granted_at, state
    ) VALUES (
      '96960000-0000-0000-0000-000000000021',
      '96969696-9696-9696-9696-969696969696',
      '96960000-0000-0000-0000-000000000010',
      'distribution-onboarding', 'subject-a',
      '96960000-0000-0000-0000-000000000001',
      'distribution-basic', 1, ARRAY['SELL'], '{}'::jsonb,
      now(), 'approver-a', now(), 'ACTIVE'
    );
    RAISE EXCEPTION 'dual beneficiary unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO platform.workflow_rights_grants (
      grant_id, tenant_id, instance_id, work_type_key,
      beneficiary_organization_id, profile_key, profile_version,
      right_types, scope, effective_from, effective_until,
      granted_by_subject_id, granted_at, state
    ) VALUES (
      '96960000-0000-0000-0000-000000000022',
      '96969696-9696-9696-9696-969696969696',
      '96960000-0000-0000-0000-000000000010',
      'distribution-onboarding',
      '96960000-0000-0000-0000-000000000001',
      'distribution-basic', 1, ARRAY['SELL'], '{}'::jsonb,
      now(), now() - interval '1 hour',
      'approver-a', now(), 'ACTIVE'
    );
    RAISE EXCEPTION 'invalid effective range unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_rights_test;
CREATE ROLE expadio_rights_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_rights_test;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.workflow_rights_grants TO expadio_rights_test;

SET ROLE expadio_rights_test;
SELECT set_config('app.tenant_id', '96969696-9696-9696-9696-969696969696', false);

DO $$
DECLARE
  visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM platform.workflow_rights_grants;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected exactly one visible rights grant, got %', visible_count;
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.workflow_rights_grants (
      grant_id, tenant_id, instance_id, work_type_key,
      beneficiary_organization_id, profile_key, profile_version,
      right_types, scope, effective_from,
      granted_by_subject_id, granted_at, state
    ) VALUES (
      '96960000-0000-0000-0000-000000000023',
      '97979797-9797-9797-9797-979797979797',
      '97970000-0000-0000-0000-000000000010',
      'distribution-onboarding',
      '97970000-0000-0000-0000-000000000001',
      'distribution-basic', 1, ARRAY['SELL'], '{}'::jsonb,
      now(), 'approver-a', now(), 'ACTIVE'
    );
    RAISE EXCEPTION 'cross-tenant rights write unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE platform.workflow_rights_grants
       SET state = 'SUSPENDED'
     WHERE grant_id = '96960000-0000-0000-0000-000000000020';
    RAISE EXCEPTION 'immutable rights update unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'workflow rights grants are immutable%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    DELETE FROM platform.workflow_rights_grants
     WHERE grant_id = '96960000-0000-0000-0000-000000000020';
    RAISE EXCEPTION 'immutable rights delete unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'workflow rights grants are immutable%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

RESET ROLE;

SELECT 'workflow rights grants smoke: ok' AS result;
