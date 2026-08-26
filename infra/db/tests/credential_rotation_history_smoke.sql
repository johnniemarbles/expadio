\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('38000000-0000-0000-0000-000000000001', 'Rotation Tenant A'),
  ('38000000-0000-0000-0000-000000000002', 'Rotation Tenant B');

INSERT INTO platform.credential_rotation_events (
  event_id, rotation_reference, sequence, request_id, tenant_id,
  requested_by_subject_id, connector_key,
  current_credential_reference, replacement_credential_reference,
  event_type, authorization_decision_id, reason, occurred_at,
  correlation_id, evidence_refs
) VALUES
  (
    '38100000-0000-0000-0000-000000000001', 'rotation://a/1', 1,
    'request-a', '38000000-0000-0000-0000-000000000001',
    'security-admin-a', 'storage-a',
    'vault://tenant-a/storage/v1', 'vault://tenant-a/storage/v2',
    'STAGED', 'decision-a', 'scheduled rotation',
    '2026-08-26T00:00:00Z',
    '38200000-0000-0000-0000-000000000001',
    ARRAY['change://credential/a']
  ),
  (
    '38100000-0000-0000-0000-000000000002', 'rotation://b/1', 1,
    'request-b', '38000000-0000-0000-0000-000000000002',
    'security-admin-b', 'storage-b',
    'secret://tenant-b/storage/v1', 'secret://tenant-b/storage/v2',
    'STAGED', 'decision-b', 'scheduled rotation',
    '2026-08-26T00:00:00Z',
    '38200000-0000-0000-0000-000000000002',
    ARRAY['change://credential/b']
  );

DROP ROLE IF EXISTS expadio_credential_rotation_test;
CREATE ROLE expadio_credential_rotation_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_credential_rotation_test;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform.credential_rotation_events
  TO expadio_credential_rotation_test;

SET ROLE expadio_credential_rotation_test;
SELECT set_config(
  'app.tenant_id',
  '38000000-0000-0000-0000-000000000001',
  false
);

DO $$
DECLARE
  event_count integer;
BEGIN
  SELECT count(*) INTO event_count FROM platform.credential_rotation_events;
  IF event_count <> 1 THEN
    RAISE EXCEPTION 'tenant A can see another tenant credential rotation';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.credential_rotation_events (
      event_id, rotation_reference, sequence, request_id, tenant_id,
      requested_by_subject_id, connector_key,
      current_credential_reference, replacement_credential_reference,
      event_type, authorization_decision_id, reason, occurred_at,
      correlation_id, evidence_refs
    ) VALUES (
      '38100000-0000-0000-0000-000000000003', 'rotation://cross/1', 1,
      'request-cross', '38000000-0000-0000-0000-000000000002',
      'security-admin-a', 'storage-b',
      'vault://tenant-b/storage/v1', 'vault://tenant-b/storage/v2',
      'STAGED', 'decision-cross', 'cross tenant',
      now(), '38200000-0000-0000-0000-000000000003',
      ARRAY['negative://cross-tenant']
    );
    RAISE EXCEPTION 'cross-tenant rotation insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  BEGIN
    DELETE FROM platform.credential_rotation_events
     WHERE rotation_reference = 'rotation://a/1';
    RAISE EXCEPTION 'credential rotation deletion unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'Credential rotation history is immutable%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.credential_rotation_events (
      event_id, rotation_reference, sequence, request_id, tenant_id,
      requested_by_subject_id, connector_key,
      current_credential_reference, replacement_credential_reference,
      event_type, authorization_decision_id, reason, occurred_at,
      correlation_id, evidence_refs
    ) VALUES (
      '38100000-0000-0000-0000-000000000004', 'rotation://invalid/1', 1,
      'request-invalid', '38000000-0000-0000-0000-000000000001',
      'security-admin-a', 'storage-a',
      'vault://tenant-a/storage/v1', 'vault://tenant-a/storage/v2',
      'ACTIVATED', 'decision-invalid', 'invalid first event',
      now(), '38200000-0000-0000-0000-000000000004',
      ARRAY['negative://sequence']
    );
    RAISE EXCEPTION 'invalid first rotation event unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

SELECT 'Credential rotation history smoke: ok' AS result;
