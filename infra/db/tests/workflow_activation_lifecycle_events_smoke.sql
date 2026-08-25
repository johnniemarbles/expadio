\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1', 'Lifecycle Tenant A'),
  ('d2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2', 'Lifecycle Tenant B');

INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES
  ('d1d10000-0000-0000-0000-000000000001', 'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1', 'Lifecycle Org A'),
  ('d2d20000-0000-0000-0000-000000000001', 'd2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2', 'Lifecycle Org B');

INSERT INTO platform.workflow_instances (
  instance_id, tenant_id, work_type_key, subject_type, subject_id,
  blueprint_key, blueprint_version, blueprint_scope, state,
  current_stage_key, revision, created_at, updated_at
) VALUES
  ('d1d10000-0000-0000-0000-000000000010', 'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',
   'partner-onboarding', 'organization', 'lifecycle-a', 'partner-onboarding', 1,
   'PLATFORM', 'RUNNING', 'verification', 7, now(), now()),
  ('d2d20000-0000-0000-0000-000000000010', 'd2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2',
   'partner-onboarding', 'organization', 'lifecycle-b', 'partner-onboarding', 1,
   'PLATFORM', 'RUNNING', 'verification', 7, now(), now());

INSERT INTO platform.workflow_rights_grants (
  grant_id, tenant_id, instance_id, work_type_key, beneficiary_organization_id,
  profile_key, profile_version, right_types, scope, effective_from,
  granted_by_subject_id, granted_at, state, evidence_refs
) VALUES
  ('d1d10000-0000-0000-0000-000000000020', 'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',
   'd1d10000-0000-0000-0000-000000000010', 'partner-onboarding',
   'd1d10000-0000-0000-0000-000000000001', 'partner', 1, ARRAY['OPERATE'],
   '{}'::jsonb, now(), 'approver-a', now(), 'ACTIVE', ARRAY['decision:a']),
  ('d2d20000-0000-0000-0000-000000000020', 'd2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2',
   'd2d20000-0000-0000-0000-000000000010', 'partner-onboarding',
   'd2d20000-0000-0000-0000-000000000001', 'partner', 1, ARRAY['OPERATE'],
   '{}'::jsonb, now(), 'approver-b', now(), 'ACTIVE', ARRAY['decision:b']);

INSERT INTO platform.workflow_activations (
  activation_id, tenant_id, instance_id, work_type_key, blueprint_key,
  blueprint_version, provisioning_model, source_rights_grant_ids,
  verification_state, provisioned_resource_refs, started_at,
  verification_evidence_refs
) VALUES
  ('d1d10000-0000-0000-0000-000000000030', 'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',
   'd1d10000-0000-0000-0000-000000000010', 'partner-onboarding',
   'partner-activation', 1, 'SCOPED_WORKSPACE',
   ARRAY['d1d10000-0000-0000-0000-000000000020']::uuid[], 'NOT_VERIFIED',
   ARRAY['workspace:a'], now(), ARRAY['activation:a']),
  ('d2d20000-0000-0000-0000-000000000030', 'd2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2',
   'd2d20000-0000-0000-0000-000000000010', 'partner-onboarding',
   'partner-activation', 1, 'ACCOUNT_ONLY',
   ARRAY['d2d20000-0000-0000-0000-000000000020']::uuid[], 'NOT_VERIFIED',
   ARRAY['account:b'], now(), ARRAY['activation:b']);

INSERT INTO platform.workflow_activation_verifications (
  verification_id, tenant_id, instance_id, activation_id, state, assessments,
  verified_by_subject_id, verified_at, reason, evidence_refs
) VALUES
  ('d1d10000-0000-0000-0000-000000000040', 'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',
   'd1d10000-0000-0000-0000-000000000010',
   'd1d10000-0000-0000-0000-000000000030', 'VERIFIED',
   '[{"dimension":"AGREEMENT","outcome":"SATISFIED","reason":"ok","evidenceRefs":["a"]},{"dimension":"RIGHTS","outcome":"SATISFIED","reason":"ok","evidenceRefs":["r"]},{"dimension":"ACCESS","outcome":"SATISFIED","reason":"ok","evidenceRefs":["x"]},{"dimension":"COMPLIANCE","outcome":"SATISFIED","reason":"ok","evidenceRefs":["c"]},{"dimension":"OPERATIONAL_READINESS","outcome":"SATISFIED","reason":"ok","evidenceRefs":["o"]}]'::jsonb,
   'verifier-a', now(), 'Verified.', ARRAY['verification:a']),
  ('d2d20000-0000-0000-0000-000000000040', 'd2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2',
   'd2d20000-0000-0000-0000-000000000010',
   'd2d20000-0000-0000-0000-000000000030', 'VERIFIED',
   '[{"dimension":"AGREEMENT","outcome":"SATISFIED","reason":"ok","evidenceRefs":["a"]},{"dimension":"RIGHTS","outcome":"SATISFIED","reason":"ok","evidenceRefs":["r"]},{"dimension":"ACCESS","outcome":"SATISFIED","reason":"ok","evidenceRefs":["x"]},{"dimension":"COMPLIANCE","outcome":"SATISFIED","reason":"ok","evidenceRefs":["c"]},{"dimension":"OPERATIONAL_READINESS","outcome":"SATISFIED","reason":"ok","evidenceRefs":["o"]}]'::jsonb,
   'verifier-b', now(), 'Verified.', ARRAY['verification:b']);

INSERT INTO platform.workflow_activation_lifecycle_events (
  event_id, tenant_id, instance_id, activation_id, from_state, to_state, action,
  affected_rights_grant_ids, monitoring_trigger_key, source_verification_id,
  performed_by_subject_id, performed_at, reason, evidence_refs
) VALUES (
  'd1d10000-0000-0000-0000-000000000050',
  'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',
  'd1d10000-0000-0000-0000-000000000010',
  'd1d10000-0000-0000-0000-000000000030',
  'ACTIVE', 'SUSPENDED', 'SUSPEND',
  ARRAY['d1d10000-0000-0000-0000-000000000020']::uuid[],
  'trade-control.status-changed',
  'd1d10000-0000-0000-0000-000000000040',
  'compliance-a', now(), 'Standing gate failed.', ARRAY['monitoring:a']
);

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.workflow_activation_lifecycle_events (
      event_id, tenant_id, instance_id, activation_id, from_state, to_state,
      action, affected_rights_grant_ids, monitoring_trigger_key,
      performed_by_subject_id, performed_at, reason, evidence_refs
    ) VALUES (
      'd1d10000-0000-0000-0000-000000000051',
      'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',
      'd1d10000-0000-0000-0000-000000000010',
      'd1d10000-0000-0000-0000-000000000030',
      'ACTIVE', 'REVOKED', 'REVOKE',
      ARRAY['d1d10000-0000-0000-0000-000000000020']::uuid[],
      'manual.revoke', 'compliance-a', now(), 'Stale action.', ARRAY['monitoring:stale']
    );
    RAISE EXCEPTION 'stale lifecycle state unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_lifecycle_test;
CREATE ROLE expadio_lifecycle_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_lifecycle_test;
GRANT SELECT ON platform.workflow_activations,
  platform.workflow_activation_verifications,
  platform.workflow_activation_lifecycle_events TO expadio_lifecycle_test;
GRANT INSERT, UPDATE, DELETE
  ON platform.workflow_activation_lifecycle_events TO expadio_lifecycle_test;

SET ROLE expadio_lifecycle_test;
SELECT set_config('app.tenant_id', 'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1', false);

DO $$
DECLARE
  visible_count integer;
  changed_count integer;
BEGIN
  SELECT count(*) INTO visible_count
    FROM platform.workflow_activation_lifecycle_events;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one visible lifecycle event, got %', visible_count;
  END IF;

  UPDATE platform.workflow_activation_lifecycle_events
     SET reason = 'changed'
   WHERE event_id = 'd1d10000-0000-0000-0000-000000000050';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'tenant update unexpectedly affected % rows', changed_count;
  END IF;

  DELETE FROM platform.workflow_activation_lifecycle_events
   WHERE event_id = 'd1d10000-0000-0000-0000-000000000050';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 0 THEN
    RAISE EXCEPTION 'tenant delete unexpectedly affected % rows', changed_count;
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.workflow_activation_lifecycle_events (
      event_id, tenant_id, instance_id, activation_id, from_state, to_state,
      action, affected_rights_grant_ids, monitoring_trigger_key,
      performed_by_subject_id, performed_at, reason, evidence_refs
    ) VALUES (
      'd2d20000-0000-0000-0000-000000000051',
      'd2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2',
      'd2d20000-0000-0000-0000-000000000010',
      'd2d20000-0000-0000-0000-000000000030',
      'ACTIVE', 'SUSPENDED', 'SUSPEND',
      ARRAY['d2d20000-0000-0000-0000-000000000020']::uuid[],
      'cross-tenant', 'compliance-a', now(), 'Cross tenant.', ARRAY['monitoring:cross']
    );
    RAISE EXCEPTION 'cross-tenant lifecycle insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege OR foreign_key_violation THEN NULL;
  END;
END;
$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    UPDATE platform.workflow_activation_lifecycle_events
       SET reason = 'changed'
     WHERE event_id = 'd1d10000-0000-0000-0000-000000000050';
    RAISE EXCEPTION 'privileged immutable lifecycle update unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'workflow activation lifecycle events are immutable%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

SELECT 'workflow activation lifecycle smoke: ok' AS result;
