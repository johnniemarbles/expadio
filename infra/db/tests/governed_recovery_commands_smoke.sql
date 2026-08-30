\set ON_ERROR_STOP on
BEGIN;

INSERT INTO platform.tenants (tenant_id, name, vertical_key) VALUES
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'Governed Recovery Tenant A', 'dentex'),
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'Governed Recovery Tenant B', 'dentex');

SELECT set_config('app.tenant_id', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', false);

INSERT INTO platform.governed_recovery_commands (
  recovery_command_id,
  tenant_id,
  idempotency_key,
  command_type,
  target_kind,
  target_id,
  target_ref,
  command_payload,
  status,
  reason,
  requested_by_subject_id,
  requested_by_role_key,
  correlation_id
) VALUES (
  'a1a10000-0000-0000-0000-000000000001',
  'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
  'recovery-command-smoke-a',
  'RETRY',
  'COMMUNICATION_DELIVERY',
  'a1a10000-0000-0000-0000-000000000101',
  '{"healthKey":"communication_deliveries_stuck_pending"}'::jsonb,
  '{"requestedAction":"retry_after_review"}'::jsonb,
  'QUEUED',
  'Operator reviewed stuck delivery and requested retry.',
  'subject-platform-operator-a',
  'PLATFORM_OPERATOR',
  'a1a10000-0000-0000-0000-000000000201'
);

INSERT INTO platform.governed_recovery_command_events (
  recovery_command_event_id,
  tenant_id,
  recovery_command_id,
  event_type,
  previous_status,
  new_status,
  actor_subject_id,
  actor_role_key,
  reason,
  evidence
) VALUES (
  'a1a10000-0000-0000-0000-000000000301',
  'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
  'a1a10000-0000-0000-0000-000000000001',
  'COMMAND_REQUESTED',
  NULL,
  'QUEUED',
  'subject-platform-operator-a',
  'PLATFORM_OPERATOR',
  'Operator reviewed stuck delivery and requested retry.',
  '{"healthKey":"communication_deliveries_stuck_pending"}'::jsonb
);

SELECT set_config('app.tenant_id', 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', false);

INSERT INTO platform.governed_recovery_commands (
  recovery_command_id,
  tenant_id,
  idempotency_key,
  command_type,
  target_kind,
  target_id,
  status,
  reason,
  requested_by_subject_id,
  requested_by_role_key,
  correlation_id
) VALUES (
  'b2b20000-0000-0000-0000-000000000001',
  'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
  'recovery-command-smoke-b',
  'MARK_RESOLVED',
  'COMMUNICATION_PROVIDER_WEBHOOK_EVENT',
  'b2b20000-0000-0000-0000-000000000101',
  'QUEUED',
  'Operator marked unmatched webhook as reviewed.',
  'subject-platform-operator-b',
  'PLATFORM_OPERATOR',
  'b2b20000-0000-0000-0000-000000000201'
);

SELECT set_config('app.tenant_id', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', false);

DO $$
DECLARE
  command_count integer;
  event_count integer;
  other_tenant_count integer;
  duplicate_blocked boolean := false;
  event_update_blocked boolean := false;
BEGIN
  SELECT count(*)::integer INTO command_count FROM platform.governed_recovery_commands;
  IF command_count <> 1 THEN
    RAISE EXCEPTION 'expected one visible recovery command for tenant A, got %', command_count;
  END IF;

  SELECT count(*)::integer INTO event_count FROM platform.governed_recovery_command_events;
  IF event_count <> 1 THEN
    RAISE EXCEPTION 'expected one visible recovery command event for tenant A, got %', event_count;
  END IF;

  SELECT count(*)::integer
    INTO other_tenant_count
    FROM platform.governed_recovery_commands
   WHERE tenant_id = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid;

  IF other_tenant_count <> 0 THEN
    RAISE EXCEPTION 'governed recovery commands leaked another tenant: %', other_tenant_count;
  END IF;

  BEGIN
    INSERT INTO platform.governed_recovery_commands (
      tenant_id,
      idempotency_key,
      command_type,
      target_kind,
      target_id,
      status,
      reason,
      requested_by_subject_id,
      requested_by_role_key,
      correlation_id
    ) VALUES (
      'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
      'recovery-command-smoke-a',
      'RETRY',
      'COMMUNICATION_DELIVERY',
      'a1a10000-0000-0000-0000-000000000102',
      'QUEUED',
      'Duplicate idempotency key should fail.',
      'subject-platform-operator-a',
      'PLATFORM_OPERATOR',
      'a1a10000-0000-0000-0000-000000000202'
    );
  EXCEPTION WHEN unique_violation THEN
    duplicate_blocked := true;
  END;

  IF NOT duplicate_blocked THEN
    RAISE EXCEPTION 'duplicate governed recovery command idempotency key was not blocked';
  END IF;

  UPDATE platform.governed_recovery_commands
     SET status = 'CLAIMED',
         claim_token = 'a1a10000-0000-0000-0000-000000000401',
         claim_expires_at = clock_timestamp() + interval '5 minutes',
         claimed_at = clock_timestamp()
   WHERE recovery_command_id = 'a1a10000-0000-0000-0000-000000000001';

  IF NOT EXISTS (
    SELECT 1
      FROM platform.governed_recovery_commands
     WHERE recovery_command_id = 'a1a10000-0000-0000-0000-000000000001'
       AND status = 'CLAIMED'
       AND updated_at > requested_at
  ) THEN
    RAISE EXCEPTION 'governed recovery command status update did not persist or touch updated_at';
  END IF;

  BEGIN
    UPDATE platform.governed_recovery_command_events
       SET reason = 'mutation should fail'
     WHERE recovery_command_event_id = 'a1a10000-0000-0000-0000-000000000301';
  EXCEPTION WHEN raise_exception THEN
    event_update_blocked := true;
  END;

  IF NOT event_update_blocked THEN
    RAISE EXCEPTION 'append-only governed recovery command event update was not blocked';
  END IF;
END $$;

ROLLBACK;
RESET app.tenant_id;
