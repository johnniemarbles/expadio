\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('39000000-0000-0000-0000-000000000001', 'Sensitive Read Tenant A'),
  ('39000000-0000-0000-0000-000000000002', 'Sensitive Read Tenant B');

INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES
  ('39000000-0000-0000-0000-000000000001', '39000000-0000-0000-0000-000000000001', 'Audit smoke scope'),
  ('39000000-0000-0000-0000-000000000002', '39000000-0000-0000-0000-000000000002', 'Audit smoke scope');

INSERT INTO platform.sensitive_read_events (
  event_id, request_id, tenant_id, organization_id, requested_by_subject_id,
  resource_type, resource_id, purpose, legal_basis,
  authorization_decision_id, authorization_reason_key, outcome,
  result_reference, classifications, source_references,
  failure_reason_key, requested_at, recorded_at,
  correlation_id, evidence_refs
) VALUES
  (
    '39100000-0000-0000-0000-000000000001', 'read-a',
    '39000000-0000-0000-0000-000000000001', '39000000-0000-0000-0000-000000000001', 'subject-a',
    'regulated-record', 'record-a', 'authorized case review', 'CONSENT',
    'decision-a', 'POLICY_ALLOWED', 'ALLOWED',
    'result://read/a', ARRAY['RESTRICTED'], ARRAY['record://a'],
    NULL, '2026-08-26T00:00:00Z', '2026-08-26T00:00:01Z',
    '39200000-0000-0000-0000-000000000001',
    ARRAY['consent://a']
  ),
  (
    '39100000-0000-0000-0000-000000000002', 'read-b',
    '39000000-0000-0000-0000-000000000002', '39000000-0000-0000-0000-000000000002', 'subject-b',
    'regulated-record', 'record-b', 'requested disclosure', 'CONSENT',
    'decision-b', 'CONSENT_REQUIRED', 'DENIED',
    NULL, ARRAY[]::text[], ARRAY[]::text[], 'CONSENT_REQUIRED',
    '2026-08-26T00:00:00Z', '2026-08-26T00:00:01Z',
    '39200000-0000-0000-0000-000000000002',
    ARRAY['policy://consent']
  );

DROP ROLE IF EXISTS expadio_sensitive_read_test;
CREATE ROLE expadio_sensitive_read_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_sensitive_read_test;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform.sensitive_read_events
  TO expadio_sensitive_read_test;

SET ROLE expadio_sensitive_read_test;
SELECT set_config('app.organization_id', '39000000-0000-0000-0000-000000000001', false);
SELECT set_config(
  'app.tenant_id',
  '39000000-0000-0000-0000-000000000001',
  false
);

DO $$
DECLARE
  event_count integer;
BEGIN
  SELECT count(*) INTO event_count FROM platform.sensitive_read_events;
  IF event_count <> 1 THEN
    RAISE EXCEPTION 'tenant A can see another tenant sensitive read';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.sensitive_read_events (
      event_id, request_id, tenant_id, organization_id, requested_by_subject_id,
      resource_type, resource_id, purpose, legal_basis,
      authorization_decision_id, authorization_reason_key, outcome,
      failure_reason_key, requested_at, recorded_at,
      correlation_id, evidence_refs, classifications, source_references
    ) VALUES (
      '39100000-0000-0000-0000-000000000003', 'read-cross',
      '39000000-0000-0000-0000-000000000002', '39000000-0000-0000-0000-000000000002', 'subject-a',
      'regulated-record', 'record-b', 'cross tenant', 'CONSENT',
      'decision-cross', 'DENIED', 'DENIED', 'DENIED',
      now(), now(), '39200000-0000-0000-0000-000000000003',
      ARRAY['negative://cross-tenant'], ARRAY[]::text[], ARRAY[]::text[]
    );
    RAISE EXCEPTION 'cross-tenant sensitive read audit unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    UPDATE platform.sensitive_read_events
       SET purpose = 'mutated'
     WHERE request_id = 'read-a';
    RAISE EXCEPTION 'sensitive read audit mutation unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'Sensitive read history is immutable%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.sensitive_read_events (
      event_id, request_id, tenant_id, organization_id, requested_by_subject_id,
      resource_type, resource_id, purpose, legal_basis,
      authorization_decision_id, authorization_reason_key, outcome,
      result_reference, classifications, source_references,
      requested_at, recorded_at, correlation_id, evidence_refs
    ) VALUES (
      '39100000-0000-0000-0000-000000000004', 'read-invalid',
      '39000000-0000-0000-0000-000000000001', '39000000-0000-0000-0000-000000000001', 'subject-a',
      'regulated-record', 'record-a', 'invalid allowed audit', 'CONSENT',
      'decision-invalid', 'POLICY_ALLOWED', 'ALLOWED',
      NULL, ARRAY[]::text[], ARRAY[]::text[],
      now(), now(), '39200000-0000-0000-0000-000000000004',
      ARRAY['negative://outcome-shape']
    );
    RAISE EXCEPTION 'invalid allowed sensitive read unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

SELECT 'Sensitive read history smoke: ok' AS result;
