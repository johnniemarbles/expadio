\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Communication Tenant E'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Communication Tenant F');

INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES
  ('e1111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Communication Org E'),
  ('f1111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Communication Org F');

INSERT INTO platform.communication_conversations (
  conversation_id, tenant_id, organization_id, subject_id, channel, owner_type, owner_id
) VALUES
  (
    'e2000000-0000-0000-0000-000000000001',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'e1111111-1111-1111-1111-111111111111',
    'subject-e',
    'whatsapp',
    'HUMAN',
    'user-e'
  ),
  (
    'f2000000-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'f1111111-1111-1111-1111-111111111111',
    'subject-f',
    'email',
    'AI',
    'agent-f'
  );

INSERT INTO platform.communication_conversation_context (
  conversation_id, tenant_id, context_kind, context_id
) VALUES
  ('e2000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'lead', 'lead-e'),
  ('f2000000-0000-0000-0000-000000000001', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'case', 'case-f');

INSERT INTO platform.communication_conversation_messages (
  message_id, conversation_id, tenant_id, channel, direction, sender_type, sender_id, body
) VALUES
  (
    'e3000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000001',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'whatsapp',
    'INBOUND',
    'PERSON',
    'subject-e',
    'Hello E'
  ),
  (
    'f3000000-0000-0000-0000-000000000001',
    'f2000000-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'email',
    'OUTBOUND',
    'AI',
    'agent-f',
    'Hello F'
  );

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_conversations (
      tenant_id, organization_id, subject_id
    ) VALUES (
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      'f1111111-1111-1111-1111-111111111111',
      'cross-tenant-org'
    );
    RAISE EXCEPTION 'cross-tenant conversation organization unexpectedly succeeded';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_communication_test;
CREATE ROLE expadio_communication_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_communication_test;
GRANT SELECT, INSERT ON
  platform.communication_conversations,
  platform.communication_conversation_context,
  platform.communication_conversation_messages
TO expadio_communication_test;

SET ROLE expadio_communication_test;
SELECT set_config('app.tenant_id', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', false);

DO $$
DECLARE
  conversation_count integer;
  context_count integer;
  message_count integer;
BEGIN
  SELECT count(*) INTO conversation_count FROM platform.communication_conversations;
  SELECT count(*) INTO context_count FROM platform.communication_conversation_context;
  SELECT count(*) INTO message_count FROM platform.communication_conversation_messages;

  IF conversation_count <> 1 THEN
    RAISE EXCEPTION 'tenant E expected 1 visible conversation, got %', conversation_count;
  END IF;
  IF context_count <> 1 THEN
    RAISE EXCEPTION 'tenant E expected 1 visible context link, got %', context_count;
  END IF;
  IF message_count <> 1 THEN
    RAISE EXCEPTION 'tenant E expected 1 visible message, got %', message_count;
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_conversations (
      conversation_id, tenant_id, organization_id, subject_id
    ) VALUES (
      'f2000000-0000-0000-0000-000000000099',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      'f1111111-1111-1111-1111-111111111111',
      'forbidden-write'
    );
    RAISE EXCEPTION 'cross-tenant RLS write unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

SELECT 'communication conversations smoke: ok' AS result;
