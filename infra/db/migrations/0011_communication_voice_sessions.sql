BEGIN;

CREATE TABLE platform.communication_voice_sessions (
  call_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid,
  connector_key text NOT NULL CHECK (btrim(connector_key) <> ''),
  provider_call_id text,
  direction text NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  from_address text NOT NULL CHECK (btrim(from_address) <> ''),
  to_address text NOT NULL CHECK (btrim(to_address) <> ''),
  from_subject_id text,
  to_subject_id text,
  state text NOT NULL CHECK (state IN ('REQUESTED','RINGING','ANSWERED','COMPLETED','FAILED','CANCELLED')),
  requested_at timestamptz NOT NULL,
  answered_at timestamptz,
  ended_at timestamptz,
  recording_ref text,
  transcript_ref text,
  conversation_id uuid,
  agent_id text,
  human_handoff_requested_at timestamptz,
  last_reason_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (call_id, tenant_id),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES platform.communication_conversations(conversation_id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT communication_voice_session_timestamps CHECK (
    (answered_at IS NULL OR answered_at >= requested_at)
    AND (ended_at IS NULL OR ended_at >= requested_at)
    AND (ended_at IS NULL OR answered_at IS NULL OR ended_at >= answered_at)
  )
);

CREATE UNIQUE INDEX communication_voice_sessions_provider_call_uq
  ON platform.communication_voice_sessions (tenant_id, connector_key, provider_call_id)
  WHERE provider_call_id IS NOT NULL;

CREATE INDEX communication_voice_sessions_state_idx
  ON platform.communication_voice_sessions (tenant_id, state, updated_at DESC);

CREATE TABLE platform.communication_voice_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  from_state text NOT NULL CHECK (from_state IN ('REQUESTED','RINGING','ANSWERED','COMPLETED','FAILED','CANCELLED')),
  to_state text NOT NULL CHECK (to_state IN ('REQUESTED','RINGING','ANSWERED','COMPLETED','FAILED','CANCELLED')),
  provider_event_id text,
  provider_call_id text,
  recording_ref text,
  transcript_ref text,
  reason_code text,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (call_id, tenant_id)
    REFERENCES platform.communication_voice_sessions(call_id, tenant_id)
    ON DELETE CASCADE,
  UNIQUE (tenant_id, provider_event_id)
);

CREATE OR REPLACE FUNCTION platform.reject_communication_voice_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'communication voice events are append-only';
END;
$$;

CREATE TRIGGER communication_voice_events_append_only
BEFORE UPDATE OR DELETE ON platform.communication_voice_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_communication_voice_event_mutation();

ALTER TABLE platform.communication_voice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_voice_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_voice_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_voice_events FORCE ROW LEVEL SECURITY;

CREATE POLICY communication_voice_sessions_tenant_isolation
  ON platform.communication_voice_sessions
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY communication_voice_events_tenant_select
  ON platform.communication_voice_events
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY communication_voice_events_tenant_insert
  ON platform.communication_voice_events
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
