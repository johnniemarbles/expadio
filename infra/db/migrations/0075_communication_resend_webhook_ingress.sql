BEGIN;

CREATE TABLE platform.communication_connector_webhook_bindings (
  webhook_binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE RESTRICT,
  connector_id uuid NOT NULL REFERENCES platform.connectors(connector_id) ON DELETE RESTRICT,
  endpoint_key uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_key text NOT NULL CHECK (provider_key IN ('resend')),
  signing_secret_ref text NOT NULL CHECK (
    signing_secret_ref ~ '^vault://tenant/[0-9a-fA-F-]{36}/connector/[A-Za-z0-9._-]{1,128}/webhook/v[0-9]{1,6}$'
  ),
  state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','REVOKED')),
  configured_by_subject_id text NOT NULL CHECK (btrim(configured_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  rotated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  UNIQUE (tenant_id, connector_id),
  UNIQUE (tenant_id, endpoint_key),
  CHECK (
    (state = 'REVOKED' AND revoked_at IS NOT NULL)
    OR (state = 'ACTIVE' AND revoked_at IS NULL)
  )
);

CREATE INDEX communication_connector_webhook_binding_endpoint_idx
  ON platform.communication_connector_webhook_bindings (tenant_id, endpoint_key)
  WHERE state = 'ACTIVE';

ALTER TABLE platform.communication_connector_webhook_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_connector_webhook_bindings FORCE ROW LEVEL SECURITY;

CREATE POLICY communication_connector_webhook_bindings_tenant_select
  ON platform.communication_connector_webhook_bindings
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY communication_connector_webhook_bindings_tenant_insert
  ON platform.communication_connector_webhook_bindings
  FOR INSERT WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY communication_connector_webhook_bindings_tenant_update
  ON platform.communication_connector_webhook_bindings
  FOR UPDATE
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.communication_webhook_dead_letters
  ADD COLUMN tenant_id uuid REFERENCES platform.tenants(tenant_id) ON DELETE RESTRICT,
  ADD COLUMN connector_key text,
  ADD COLUMN endpoint_key uuid;

CREATE INDEX communication_webhook_dead_letters_tenant_idx
  ON platform.communication_webhook_dead_letters (tenant_id, received_at DESC)
  WHERE tenant_id IS NOT NULL;

COMMENT ON TABLE platform.communication_connector_webhook_bindings IS
  'Tenant-scoped inbound webhook routing metadata. signing_secret_ref is an opaque Vault reference; plaintext webhook secrets are never persisted.';

COMMIT;
