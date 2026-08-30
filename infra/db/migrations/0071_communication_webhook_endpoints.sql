BEGIN;

-- Public provider callbacks resolve through an opaque endpoint id into the
-- trusted Communications control plane. The endpoint stores no raw secret:
-- only a custody reference dedicated to webhook verification.
CREATE TABLE platform.communication_webhook_endpoints (
  endpoint_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  connector_id uuid NOT NULL REFERENCES platform.connectors(connector_id) ON DELETE CASCADE,
  provider_key text NOT NULL CHECK (provider_key IN ('resend','twilio')),
  adapter_key text NOT NULL,
  verification_credential_ref text NOT NULL CHECK (btrim(verification_credential_ref) <> ''),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, connector_id, provider_key, adapter_key)
);

CREATE INDEX communication_webhook_endpoints_connector_idx
  ON platform.communication_webhook_endpoints (tenant_id, connector_id)
  WHERE enabled = true;

ALTER TABLE platform.communication_webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_webhook_endpoints FORCE ROW LEVEL SECURITY;

-- Normal tenant context may manage only its own endpoint metadata. The public
-- webhook resolver can inspect the minimum routing/custody metadata only after
-- its dedicated machine boundary binds app.webhook_control_plane=on.
CREATE POLICY communication_webhook_endpoints_control_plane
  ON platform.communication_webhook_endpoints
  FOR ALL
  USING (
    CASE
      WHEN current_setting('app.webhook_control_plane', true) = 'on' THEN true
      ELSE tenant_id = platform.current_tenant_id()
    END
  )
  WITH CHECK (
    CASE
      WHEN current_setting('app.webhook_control_plane', true) = 'on' THEN true
      ELSE tenant_id = platform.current_tenant_id()
    END
  );

COMMENT ON COLUMN platform.communication_webhook_endpoints.verification_credential_ref IS
  'Dedicated webhook signature-verification secret reference. Must not reuse the provider API credential.';

COMMIT;
