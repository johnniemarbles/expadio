\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'Activation Tenant A'),
  ('a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2', 'Activation Tenant B');

INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES
  ('a1a10000-0000-0000-0000-000000000001', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'Activation Org A'),
  ('a2a20000-0000-0000-0000-000000000001', 'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2', 'Activation Org B');

INSERT INTO platform.workflow_instances (
  instance_id, tenant_id, work_type_key, subject_type, subject_id,
  blueprint_key, blueprint_version, blueprint_scope, state,
  current_stage_key, revision, created_at, updated_at
) VALUES
  (
    'a1a10000-0000-0000-0000-000000000010',
    'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
    'distribution-onboarding', 'organization', 'activation-org-a',
    'distribution-onboarding', 1, 'PLATFORM', 'RUNNING',
    'activation', 5, now(), now()
  ),
  (
    'a2a20000-0000-0000-0000-000000000010',
    'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2',
    'distribution-onboarding', 'organization', 'activation-org-b',
    'distribution-onboarding', 1, 'PLATFORM', 'RUNNING',
    'activation', 5, now(), now()
  );

INSERT INTO platform.workflow_rights_grants (
  grant_id, tenant_id, instance_id, work_type_key,
  beneficiary_organization_id, profile_key, profile_version,
  right_types, scope, effective_from, granted_by_subject_id,
  granted_at, state, evidence_refs
) VALUES
  (
    'a1a10000-0000-0000-0000-000000000020',
    'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
    'a1a10000-0000-0000-0000-000000000010',
    'distribution-onboarding',
    'a1a10000-0000-0000-0000-000000000001',
    'distribution-basic', 1, ARRAY['SELL'], '{}'::jsonb,
    now(), 'approver-a', now(), 'ACTIVE', ARRAY['decision:a']
  ),
  (
    'a2a20000-0000-0000-0000-000000000020',
    'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2',
    'a2a20000-0000-0000-0000-000000000010',
    'distribution-onboarding',
    'a2a20000-0000-0000-0000-000000000001',
    'distribution-basic', 1, ARRAY['SELL'], '{}'::jsonb,
    now(), 'approver-b', now(), 'ACTIVE', ARRAY['decision:b']
  );

INSERT INTO platform.workflow_activations (
  activation_id, tenant_id, instance_id, work_type_key,
  blueprint_key, blueprint_version, provisioning_model,
  source_rights_grant_ids, verification_state,
  provisioned_resource_refs, started_at, verification_evidence_refs
) VALUES (
  'a1a10000-0000-0000-0000-000000000030',
  'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
  'a1a10000-0000-0000-0000-000000000010',
  'distribution-onboarding', 'distribution-activation', 3,
  'SCOPED_WORKSPACE',
  ARRAY['a1a10000-0000-0000-0000-000000000020']::uuid[],
  'NOT_VERIFIED', ARRAY[]::text[], now(), ARRAY['decision:a']
);

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.workflow_activations (
      activation_id, tenant_id, instance_id, work_type_key,
      blueprint_key, blueprint_version, provisioning_model,
      source_rights_grant_ids, verification_state
    ) VALUES (
      'a1a10000-0000-0000-0000-000000000031',
      'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
      'a1a10000-0000-0000-0000-000000000010',
      'distribution-onboarding', 'distribution-activation', 3,
      'SCOPED_WORKSPACE',
      ARRAY['a2a20000-0000-0000-0000-000000000020']::uuid[],
      'NOT_VERIFIED'
    );
    RAISE EXCEPTION 'cross-tenant source grant unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'activation source rights grants must be unique%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_activation_test;
CREATE ROLE expadio_activation_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_activation_test;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.workflow_activations TO expadio_activation_test;

SET ROLE expadio_activation_test;
SELECT set_config('app.tenant_id', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', false);

DO $$
DECLARE
  visible_count integer;
  changed_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM platform.workflow_activations;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one visible activation, got %', visible_count;
  END IF;

  UPDATE platform.workflow_activations
     SET verification_state = 'FAILED'
   WHERE activation_id = 'a1a10000-0000-0000-0000-000000000030';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'tenant update unexpectedly affected % rows', changed_count;
  END IF;

  DELETE FROM platform.workflow_activations
   WHERE activation_id = 'a1a10000-0000-0000-0000-000000000030';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'tenant delete unexpectedly affected % rows', changed_count;
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.workflow_activations (
      activation_id, tenant_id, instance_id, work_type_key,
      blueprint_key, blueprint_version, provisioning_model,
      source_rights_grant_ids, verification_state
    ) VALUES (
      'a2a20000-0000-0000-0000-000000000031',
      'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2',
      'a2a20000-0000-0000-0000-000000000010',
      'distribution-onboarding', 'distribution-activation', 3,
      'SCOPED_WORKSPACE',
      ARRAY['a2a20000-0000-0000-0000-000000000020']::uuid[],
      'NOT_VERIFIED'
    );
    RAISE EXCEPTION 'cross-tenant activation write unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    UPDATE platform.workflow_activations
       SET verification_state = 'FAILED'
     WHERE activation_id = 'a1a10000-0000-0000-0000-000000000030';
    RAISE EXCEPTION 'privileged immutable activation update unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'workflow activations are immutable%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    DELETE FROM platform.workflow_activations
     WHERE activation_id = 'a1a10000-0000-0000-0000-000000000030';
    RAISE EXCEPTION 'privileged immutable activation delete unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'workflow activations are immutable%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

SELECT 'workflow activations smoke: ok' AS result;
