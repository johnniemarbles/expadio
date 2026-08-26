\set ON_ERROR_STOP on

INSERT INTO platform.credential_rotation_events (
  event_id, rotation_reference, sequence, request_id, tenant_id,
  requested_by_subject_id, connector_key,
  current_credential_reference, replacement_credential_reference,
  event_type, authorization_decision_id, reason, occurred_at,
  correlation_id, evidence_refs
) VALUES
  (
    '38100000-0000-0000-0000-000000000005', 'rotation://a/1', 2,
    'request-a', '38000000-0000-0000-0000-000000000001',
    'security-admin-a2', 'storage-a',
    'vault://tenant-a/storage/v1', 'vault://tenant-a/storage/v2',
    'ACTIVATED', 'decision-activate-a', 'replacement verified',
    '2026-08-26T00:01:00Z',
    '38200000-0000-0000-0000-000000000005',
    ARRAY['verification://credential/a']
  ),
  (
    '38100000-0000-0000-0000-000000000006', 'rotation://a/1', 3,
    'request-a', '38000000-0000-0000-0000-000000000001',
    'security-admin-a3', 'storage-a',
    'vault://tenant-a/storage/v1', 'vault://tenant-a/storage/v2',
    'REVOKED', 'decision-revoke-a', 'superseded reference revoked',
    '2026-08-26T00:02:00Z',
    '38200000-0000-0000-0000-000000000006',
    ARRAY['revocation://credential/a']
  );

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
      '38100000-0000-0000-0000-000000000007', 'rotation://b/1', 3,
      'request-b', '38000000-0000-0000-0000-000000000002',
      'security-admin-b2', 'storage-b',
      'secret://tenant-b/storage/v1', 'secret://tenant-b/storage/v2',
      'REVOKED', 'decision-gap-b', 'invalid sequence gap',
      now(), '38200000-0000-0000-0000-000000000007',
      ARRAY['negative://sequence-gap']
    );
    RAISE EXCEPTION 'rotation sequence gap unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE
        'Credential rotation event sequence must be contiguous%'
      THEN
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
      '38100000-0000-0000-0000-000000000008', 'rotation://a/1', 4,
      'request-a', '38000000-0000-0000-0000-000000000001',
      'security-admin-a4', 'storage-a',
      'vault://tenant-a/storage/v1', 'vault://tenant-a/storage/v2',
      'REVOKED', 'decision-repeat-a', 'invalid terminal continuation',
      now(), '38200000-0000-0000-0000-000000000008',
      ARRAY['negative://terminal-continuation']
    );
    RAISE EXCEPTION 'terminal rotation continuation unexpectedly succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE
        'Credential rotation transition REVOKED -> REVOKED is invalid%'
      THEN
        RAISE;
      END IF;
  END;
END;
$$;

SELECT 'Credential rotation transition guard smoke: ok' AS result;
