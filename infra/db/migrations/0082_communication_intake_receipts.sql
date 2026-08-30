BEGIN;

-- Server-issued proof only. No secret bytes or browser-supplied probe claims.
CREATE TABLE platform.communication_intake_receipts (
  receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id),
  subject_id text NOT NULL,
  connector_key text NOT NULL,
  provider_key text NOT NULL,
  credential_ref text NOT NULL,
  key_version text NOT NULL,
  fingerprint text NOT NULL,
  detected_capabilities text[] NOT NULL,
  probe_warnings jsonb NOT NULL,
  probed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  consumed_at timestamptz,
  CHECK (expires_at > created_at)
);

ALTER TABLE platform.communication_intake_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_intake_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY communication_intake_receipts_admin
  ON platform.communication_intake_receipts
  USING (tenant_id = platform.current_tenant_id()
    AND current_setting('app.platform_admin', true) = 'true')
  WITH CHECK (tenant_id = platform.current_tenant_id()
    AND current_setting('app.platform_admin', true) = 'true');

-- Legacy rows are deliberately not backfilled with fabricated evidence.
ALTER TABLE platform.connector_credentials
  ADD COLUMN intake_receipt_id uuid UNIQUE
    REFERENCES platform.communication_intake_receipts(receipt_id);

COMMIT;
