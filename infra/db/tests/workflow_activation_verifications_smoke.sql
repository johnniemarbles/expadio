\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1', 'Verification Tenant A'),
  ('c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'Verification Tenant B');

INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES
  ('c1c10000-0000-0000-0000-000000000001', 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1', 'Verification Org A'),
  ('c2c20000-0000-0000-0000-000000000001', 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2', 'Verification Org B');

INSERT INTO platform.workflow_instances (
  instance_id, tenant_id, work_type_key, subject_type, subject_id,
  blueprint_key, blueprint_version, blueprint_scope, state,
  current_stage_key, revision, created_at, updated_at
) VALUES
  (
    'c1c10000-0000-0000-0000-000000000010',
    'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
    'partner-onboarding', 'organization', 'verification-org-a',
    'partner-onboarding', 1, 'PLATFORM', 'RUNNING',
    'verification', 6, now(), now()
  ),
  (
    'c1c10000-0000-0000-0000-000000000011',
    'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
    'partner-onboarding', 'organization', 'verification-org-a-2',
    'partner-onboarding', 1, 'PLATFORM', 'RUNNING',
    'verification', 6, now(), now()
  ),
  (
    'c2c20000-0000-0000-0000-000000000010',
    'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2',
    'partner-onboarding', 'organization', 'verification-org-b',
    'partner-onboarding', 1, 'PLATFORM', 'RUNNING',
    'verification', 6, now(), now()
  );

INSERT INTO platform.workflow_rights_grants (
  grant_id, tenant_id, instance_id, work_type_key,
  beneficiary_organization_id, profile_key, profile_version,
  right_types, scope, effective_from, granted_by_subject_id,
  granted_at, state, evidence_refs
) VALUES
  (
    'c1c10000-0000-0000-0000-000000000020',
    'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
    'c1c10000-0000-0000-0000-000000000010',
    'partner-onboarding',
    'c1c10000-0000-0000-0000-000000000001',
    'partner', 1, ARRAY['OPERATE'], '{}'::jsonb,
    now(), 'approver-a', now(), 'ACTIVE', ARRAY['decision:a']
  ),
  (
    'c2c20000-0000-0000-0000-000000000020',
    'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2',
    'c2c20000-0000-0000-0000-000000000010',
    'partner-onboarding',
    'c2c20000-0000-0000-0000-000000000001',
    'partner', 1, ARRAY['OPERATE'], '{}'::jsonb,
    now(), 'approver-b', now(), 'ACTIVE', ARRAY['decision:b']
  );

INSERT INTO platform.workflow_activations (
  activation_id, tenant_id, instance_id, work_type_key,
  blueprint_key, blueprint_version, provisioning_model,
  source_rights_grant_ids, verification_state,
  provisioned_resource_refs, started_at, verification_evidence_refs
) VALUES
  (
    'c1c10000-0000-0000-0000-000000000030',
    'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
    'c1c10000-0000-0000-0000-000000000010',
    'partner-onboarding', 'partner-activation', 1,
    'SCOPED_WORKSPACE',
    ARRAY['c1c10000-0000-0000-0000-000000000020']::uuid[],
    'NOT_VERIFIED', ARRAY['workspace:a'], now(), ARRAY['activation:a']
  ),
  (
    'c2c20000-0000-0000-0000-000000000030',
    'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2',
    'c2c20000-0000-0000-0000-000000000010',
    'partner-onboarding', 'partner-activation', 1,
    'ACCOUNT_ONLY',
    ARRAY['c2c20000-0000-0000-0000-000000000020']::uuid[],
    'NOT_VERIFIED', ARRAY['account:b'], now(), ARRAY['activation:b']
  );

INSERT INTO platform.workflow_activation_verifications (
  verification_id, tenant_id, instance_id, activation_id, state,
  assessments, verified_by_subject_id, verified_at, reason, evidence_refs
) VALUES (
  'c1c10000-0000-0000-0000-000000000040',
  'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
  'c1c10000-0000-0000-0000-000000000010',
  'c1c10000-0000-0000-0000-000000000030',
  'VERIFIED',
  '[
    {"dimension":"AGREEMENT","outcome":"SATISFIED","reason":"current","evidenceRefs":["agreement:1"]},
    {"dimension":"RIGHTS","outcome":"SATISFIED","reason":"active","evidenceRefs":["rights:1"]},
    {"dimension":"ACCESS","outcome":"SATISFIED","reason":"tested","evidenceRefs":["access:1"]},
    {"dimension":"COMPLIANCE","outcome":"SATISFIED","reason":"passed","evidenceRefs":["compliance:1"]},
    {"dimension":"OPERATIONAL_READINESS","outcome":"SATISFIED","reason":"ready","evidenceRefs":["readiness:1"]}
  ]'::jsonb,
  'verifier-a', now(), 'All independent controls passed.',
  ARRAY['verification-pack:1']
);

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.workflow_activation_verifications (
      verification_id, tenant_id, instance_id, activation_id, state,
      assessments, verified_by_subject_id, verified_at, reason, evidence_refs
    )
    SELECT
      'c1c10000-0000-0000-0000-000000000041',
      tenant_id,
      'c1c10000-0000-0000-0000-000000000011',
      activation_id,
      'FAILED',
      assessments,
      'verifier-a',
      now(),
      'Wrong instance.',
      ARRAY['verification-pack:wrong']
    FROM platform.workflow_activation_verifications
    WHERE verification_id = 'c1c10000-0000-0000-0000-000000000040';
    RAISE EXCEPTION 'cross-instance verification unexpectedly succeeded';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_activation_verification_test;
CREATE ROLE expadio_activation_verification_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_activation_verification_test;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform.workflow_activation_verifications
  TO expadio_activation_verification_test;

SET ROLE expadio_activation_verification_test;
SELECT set_config('app.tenant_id', 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1', false);

DO $$
DECLARE
  visible_count integer;
  changed_count integer;
BEGIN
  SELECT count(*) INTO visible_count
    FROM platform.workflow_activation_verifications;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one visible verification, got %', visible_count;
  END IF;

  UPDATE platform.workflow_activation_verifications
     SET state = 'FAILED'
   WHERE verification_id = 'c1c10000-0000-0000-0000-000000000040';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'tenant update unexpectedly affected % rows', changed_count;
  END IF;

  DELETE FROM platform.workflow_activation_verifications
   WHERE verification_id = 'c1c10000-0000-0000-0000-000000000040';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'tenant delete unexpectedly affected % rows', changed_count;
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.workflow_activation_verifications (
      verification_id, tenant_id, instance_id, activation_id, state,
      assessments, verified_by_subject_id, verified_at, reason, evidence_refs
    ) VALUES (
      'c2c20000-0000-0000-0000-000000000041',
      'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2',
      'c2c20000-0000-0000-0000-000000000010',
      'c2c20000-0000-0000-0000-000000000030',
      'FAILED',
      '[
        {"dimension":"AGREEMENT","outcome":"NOT_SATISFIED","reason":"missing","evidenceRefs":["agreement:missing"]},
        {"dimension":"RIGHTS","outcome":"SATISFIED","reason":"active","evidenceRefs":["rights:1"]},
        {"dimension":"ACCESS","outcome":"SATISFIED","reason":"tested","evidenceRefs":["access:1"]},
        {"dimension":"COMPLIANCE","outcome":"SATISFIED","reason":"passed","evidenceRefs":["compliance:1"]},
        {"dimension":"OPERATIONAL_READINESS","outcome":"SATISFIED","reason":"ready","evidenceRefs":["readiness:1"]}
      ]'::jsonb,
      'verifier-a', now(), 'Cross tenant.', ARRAY['verification-pack:cross']
    );
    RAISE EXCEPTION 'cross-tenant verification insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    UPDATE platform.workflow_activation_verifications
       SET state = 'FAILED'
     WHERE verification_id = 'c1c10000-0000-0000-0000-000000000040';
    RAISE EXCEPTION 'privileged immutable verification update unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'workflow activation verifications are immutable%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    DELETE FROM platform.workflow_activation_verifications
     WHERE verification_id = 'c1c10000-0000-0000-0000-000000000040';
    RAISE EXCEPTION 'privileged immutable verification delete unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'workflow activation verifications are immutable%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

SELECT 'workflow activation verifications smoke: ok' AS result;
