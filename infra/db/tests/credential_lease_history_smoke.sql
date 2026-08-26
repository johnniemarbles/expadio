\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('37000000-0000-0000-0000-000000000001', 'Credential Tenant A'),
  ('37000000-0000-0000-0000-000000000002', 'Credential Tenant B');

INSERT INTO platform.credential_lease_events (
  event_id, request_id, tenant_id, requested_by_subject_id,
  connector_key, credential_reference, purpose,
  authorization_decision_id, authorization_reason_key, outcome,
  lease_reference, issuer_audit_reference, failure_reason_key,
  requested_at, issued_at, expires_at, recorded_at,
  correlation_id, evidence_refs
) VALUES
  (
    '37100000-0000-0000-0000-000000000001', 'lease-a',
    '37000000-0000-0000-0000-000000000001', 'subject-a',
    'storage-a', 'vault://tenant-a/storage', 'object.write',
    'decision-a', 'POLICY_ALLOWED', 'ISSUED',
    'lease://a/1', 'audit://issuer/a/1', NULL,
    '2026-08-26T00:00:00Z', '2026-08-26T00:00:01Z',
    '2026-08-26T00:05:01Z', '2026-08-26T00:00:02Z',
    '37200000-0000-0000-0000-000000000001',
    ARRAY['approval://credential/a']
  ),
  (
    '37100000-0000-0000-0000-000000000002', 'lease-b',
    '37000000-0000-0000-0000-000000000002', 'subject-b',
    'storage-b', 'secret://tenant-b/storage', 'object.read',
    'decision-b', 'SUBJECT_NOT_ALLOWED', 'DENIED',
    NULL, NULL, 'SUBJECT_NOT_ALLOWED',
    '2026-08-26T00:00:00Z', NULL, NULL, '2026-08-26T00:00:01Z',
    '37200000-0000-0000-0000-000000000002',
    ARRAY['policy://credential/b']
  );

DROP ROLE IF EXISTS expadio_credential_lease_test;
CREATE ROLE expadio_credential_lease_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_credential_lease_test;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform.credential_lease_events
  TO expadio_credential_lease_test;

SET ROLE expadio_credential_lease_test;
SELECT set_config(
  'app.tenant_id',
  '37000000-0000-0000-0000-000000000001',
  false
);

DO $$
DECLARE
  event_count integer;
BEGIN
  SELECT count(*) INTO event_count FROM platform.credential_lease_events;
  IF event_count <> 1 THEN
    RAISE EXCEPTION 'tenant A can see another tenant credential lease event';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.credential_lease_events (
      event_id, request_id, tenant_id, requested_by_subject_id,
      connector_key, credential_reference, purpose,
      authorization_decision_id, authorization_reason_key, outcome,
      failure_reason_key, requested_at, recorded_at,
      correlation_id, evidence_refs
    ) VALUES (
      '37100000-0000-0000-0000-000000000003', 'cross-tenant',
      '37000000-0000-0000-0000-000000000002', 'subject-a',
      'storage-b', 'vault://tenant-b/storage', 'object.read',
      'decision-cross', 'DENIED', 'DENIED', 'DENIED',
      now(), now(), '37200000-0000-0000-0000-000000000003',
      ARRAY['negative://cross-tenant']
    );
    RAISE EXCEPTION 'cross-tenant credential lease insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    UPDATE platform.credential_lease_events
       SET purpose = 'mutated'
     WHERE request_id = 'lease-a';
    RAISE EXCEPTION 'credential lease mutation unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'Credential lease history is immutable%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.credential_lease_events (
      event_id, request_id, tenant_id, requested_by_subject_id,
      connector_key, credential_reference, purpose,
      authorization_decision_id, authorization_reason_key, outcome,
      lease_reference, issuer_audit_reference,
      requested_at, issued_at, expires_at, recorded_at,
      correlation_id, evidence_refs
    ) VALUES (
      '37100000-0000-0000-0000-000000000004', 'overlong',
      '37000000-0000-0000-0000-000000000001', 'subject-a',
      'storage-a', 'vault://tenant-a/storage', 'object.write',
      'decision-long', 'POLICY_ALLOWED', 'ISSUED',
      'lease://a/overlong', 'audit://issuer/a/overlong',
      '2026-08-26T00:00:00Z', '2026-08-26T00:00:01Z',
      '2026-08-26T00:15:02Z', '2026-08-26T00:00:02Z',
      '37200000-0000-0000-0000-000000000004',
      ARRAY['negative://overlong']
    );
    RAISE EXCEPTION 'overlong credential lease unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

SELECT 'Credential lease history smoke: ok' AS result;
