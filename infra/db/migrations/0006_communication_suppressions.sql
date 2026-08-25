BEGIN;

CREATE TABLE platform.communication_suppressions (
  suppression_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid,
  recipient_key text NOT NULL CHECK (btrim(recipient_key) <> ''),
  channel text NOT NULL CHECK (channel IN ('email','sms','whatsapp','voice','in_app','push','rcs')),
  reason text NOT NULL CHECK (reason IN ('BOUNCE','COMPLAINT','OPT_OUT','LEGAL_HOLD','UNSUBSCRIBE')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  source_message_id text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT communication_suppression_validity CHECK (
    valid_until IS NULL OR valid_until > recorded_at
  ),
  CONSTRAINT communication_suppression_revocation CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
  )
);

-- NULL organization means tenant-wide suppression. Organization-specific rows
-- narrow that scope without exposing cross-tenant recipient lists.
CREATE UNIQUE INDEX communication_suppressions_active_uq
  ON platform.communication_suppressions (
    tenant_id,
    COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
    channel,
    lower(recipient_key)
  )
  WHERE status = 'ACTIVE';

CREATE INDEX communication_suppressions_lookup_idx
  ON platform.communication_suppressions (
    tenant_id,
    organization_id,
    channel,
    lower(recipient_key),
    status
  );

ALTER TABLE platform.communication_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_suppressions FORCE ROW LEVEL SECURITY;
CREATE POLICY communication_suppressions_tenant_isolation
  ON platform.communication_suppressions
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
