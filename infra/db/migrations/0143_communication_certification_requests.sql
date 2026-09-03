BEGIN;

CREATE TABLE IF NOT EXISTS platform.communication_certification_requests (
  certification_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE RESTRICT,
  organization_id uuid,
  action_intent_id uuid NOT NULL REFERENCES platform.governed_action_intents(action_intent_id) ON DELETE RESTRICT,
  delivery_id uuid NOT NULL,
  connector_key text NOT NULL CHECK (btrim(connector_key) <> ''),
  provider_key text NOT NULL CHECK (btrim(provider_key) <> ''),
  channel text NOT NULL CHECK (channel IN ('email','sms','whatsapp','voice')),
  adapter_key text NOT NULL CHECK (btrim(adapter_key) <> ''),
  capability_key text NOT NULL CHECK (btrim(capability_key) <> ''),
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  operator_subject_id text NOT NULL CHECK (btrim(operator_subject_id) <> ''),
  status text NOT NULL DEFAULT 'CERTIFYING'
    CHECK (status IN ('CERTIFYING','LIVE_CERTIFIED','FAILED','REVOKED')),
  certification_id uuid REFERENCES platform.communication_certifications(certification_id) ON DELETE RESTRICT,
  failure_reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (delivery_id, tenant_id)
    REFERENCES platform.communication_deliveries(delivery_id, tenant_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, delivery_id),
  CHECK (
    (status = 'CERTIFYING' AND certification_id IS NULL AND completed_at IS NULL)
    OR
    (status <> 'CERTIFYING' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS communication_certification_requests_lookup_idx
  ON platform.communication_certification_requests (
    tenant_id, connector_key, channel, status, requested_at DESC
  );

ALTER TABLE platform.communication_certification_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_certification_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS communication_certification_requests_select ON platform.communication_certification_requests;
CREATE POLICY communication_certification_requests_select
  ON platform.communication_certification_requests
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

DROP POLICY IF EXISTS communication_certification_requests_insert ON platform.communication_certification_requests;
CREATE POLICY communication_certification_requests_insert
  ON platform.communication_certification_requests
  FOR INSERT WITH CHECK (tenant_id = platform.current_tenant_id());

DROP POLICY IF EXISTS communication_certification_requests_update ON platform.communication_certification_requests;
CREATE POLICY communication_certification_requests_update
  ON platform.communication_certification_requests
  FOR UPDATE
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

DROP POLICY IF EXISTS communication_certification_requests_delete ON platform.communication_certification_requests;
CREATE POLICY communication_certification_requests_delete
  ON platform.communication_certification_requests
  FOR DELETE USING (false);

INSERT INTO platform.communication_templates (
  scope, tenant_id, organization_id, trigger_key, channel, locale,
  content_format, subject, title, body, required_variables,
  default_variables, status
)
SELECT
  'PLATFORM', NULL, NULL, 'communications.live-certification', seed.channel,
  'en', 'TEXT', seed.subject, seed.title, seed.body,
  seed.required_variables::jsonb, '{}'::jsonb, 'ACTIVE'
FROM (
  VALUES
    ('email', 'EXPADIO Communications certification', NULL,
     'This delivery certifies the governed EXPADIO Communications email lifecycle.',
     '[]'),
    ('sms', NULL, NULL,
     'EXPADIO Communications governed SMS certification delivery.',
     '[]'),
    ('whatsapp', NULL, NULL,
     'EXPADIO Communications governed WhatsApp certification delivery.',
     '[]'),
    ('voice', NULL, NULL, '{{voiceUrl}}', '["voiceUrl"]')
) AS seed(channel, subject, title, body, required_variables)
WHERE NOT EXISTS (
  SELECT 1
    FROM platform.communication_templates existing
   WHERE existing.scope = 'PLATFORM'
     AND existing.trigger_key = 'communications.live-certification'
     AND existing.channel = seed.channel
     AND lower(existing.locale) = 'en'
     AND existing.status = 'ACTIVE'
);

COMMIT;
