BEGIN;

CREATE TABLE platform.communication_conversations (
  conversation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid,
  subject_id text,
  channel text CHECK (channel IN ('email','sms','whatsapp','voice','in_app','push','rcs')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  owner_type text NOT NULL DEFAULT 'SYSTEM' CHECK (owner_type IN ('HUMAN','AI','SYSTEM')),
  owner_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE (conversation_id, tenant_id),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT communication_conversation_closed_at CHECK (
    (status = 'OPEN' AND closed_at IS NULL)
    OR status = 'CLOSED'
  )
);

CREATE INDEX communication_conversations_subject_idx
  ON platform.communication_conversations(tenant_id, subject_id, updated_at DESC)
  WHERE subject_id IS NOT NULL;

CREATE TABLE platform.communication_conversation_context (
  conversation_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  context_kind text NOT NULL CHECK (btrim(context_kind) <> ''),
  context_id text NOT NULL CHECK (btrim(context_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, context_kind, context_id),
  FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES platform.communication_conversations(conversation_id, tenant_id)
    ON DELETE CASCADE
);

CREATE INDEX communication_conversation_context_lookup_idx
  ON platform.communication_conversation_context(tenant_id, context_kind, context_id);

CREATE TABLE platform.communication_conversation_messages (
  message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms','whatsapp','voice','in_app','push','rcs')),
  direction text NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  sender_type text NOT NULL CHECK (sender_type IN ('PERSON','HUMAN','AI','SYSTEM')),
  sender_id text,
  communication_message_id text,
  provider_message_id text,
  body text,
  payload jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES platform.communication_conversations(conversation_id, tenant_id)
    ON DELETE CASCADE
);

CREATE INDEX communication_conversation_messages_timeline_idx
  ON platform.communication_conversation_messages(tenant_id, conversation_id, occurred_at, message_id);

CREATE INDEX communication_conversation_messages_comms_message_idx
  ON platform.communication_conversation_messages(tenant_id, communication_message_id)
  WHERE communication_message_id IS NOT NULL;

CREATE INDEX communication_conversation_messages_provider_message_idx
  ON platform.communication_conversation_messages(tenant_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

ALTER TABLE platform.communication_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY communication_conversations_tenant_isolation
  ON platform.communication_conversations
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.communication_conversation_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_conversation_context FORCE ROW LEVEL SECURITY;
CREATE POLICY communication_conversation_context_tenant_isolation
  ON platform.communication_conversation_context
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.communication_conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_conversation_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY communication_conversation_messages_tenant_isolation
  ON platform.communication_conversation_messages
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
