BEGIN;

CREATE TABLE platform.communication_certifications (
  certification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid,
  connector_key text NOT NULL CHECK (btrim(connector_key) <> ''),
  provider_key text NOT NULL CHECK (btrim(provider_key) <> ''),
  channel text NOT NULL CHECK (channel IN ('email','sms','whatsapp','voice','push','rcs')),
  adapter_key text NOT NULL CHECK (btrim(adapter_key) <> ''),
  capability_key text NOT NULL CHECK (btrim(capability_key) <> ''),
  delivery_id uuid NOT NULL,
  provider_attempt_id uuid NOT NULL,
  provider_message_id text NOT NULL CHECK (btrim(provider_message_id) <> ''),
  webhook_event_id text NOT NULL CHECK (btrim(webhook_event_id) <> ''),
  decision_trace_id uuid,
  execution_trace_id uuid,
  final_delivery_state text NOT NULL CHECK (final_delivery_state IN ('DELIVERED','BOUNCED','COMPLAINED','FAILED','CANCELLED')),
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  operator_subject_id text NOT NULL CHECK (btrim(operator_subject_id) <> ''),
  certified_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'LIVE_CERTIFIED' CHECK (status IN ('CERTIFYING','LIVE_CERTIFIED','FAILED','REVOKED')),
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX communication_certifications_live_connector_uq
  ON platform.communication_certifications (tenant_id, connector_key, channel)
  WHERE status = 'LIVE_CERTIFIED';

CREATE INDEX communication_certifications_lookup_idx
  ON platform.communication_certifications (
    tenant_id,
    connector_key,
    channel,
    status,
    certified_at DESC
  );

ALTER TABLE platform.communication_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_certifications FORCE ROW LEVEL SECURITY;

CREATE POLICY communication_certifications_select
  ON platform.communication_certifications
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE POLICY communication_certifications_insert
  ON platform.communication_certifications
  FOR INSERT
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY communication_certifications_update
  ON platform.communication_certifications
  FOR UPDATE
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY communication_certifications_delete
  ON platform.communication_certifications
  FOR DELETE
  USING (false);

COMMIT;
