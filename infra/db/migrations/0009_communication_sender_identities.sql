BEGIN;

CREATE TABLE platform.communication_sender_identities (
  sender_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('PLATFORM','TENANT','ORGANIZATION')),
  tenant_id uuid REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid,
  channel text NOT NULL CHECK (channel IN ('email','sms','whatsapp','voice','rcs')),
  address text NOT NULL CHECK (btrim(address) <> ''),
  display_name text,
  reply_to text,
  purposes text[] NOT NULL
    CHECK (
      cardinality(purposes) > 0
      AND purposes <@ ARRAY['transactional','marketing','system']::text[]
    ),
  is_default boolean NOT NULL DEFAULT false,
  is_system_fallback boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'PENDING'
    CHECK (verification_status IN ('PENDING','VERIFIED','FAILED','REVOKED')),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','INACTIVE','SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT communication_sender_scope_shape CHECK (
    (scope = 'PLATFORM' AND tenant_id IS NULL AND organization_id IS NULL)
    OR
    (scope = 'TENANT' AND tenant_id IS NOT NULL AND organization_id IS NULL)
    OR
    (scope = 'ORGANIZATION' AND tenant_id IS NOT NULL AND organization_id IS NOT NULL)
  ),
  CONSTRAINT communication_sender_system_fallback_shape CHECK (
    NOT is_system_fallback OR (scope = 'PLATFORM' AND is_default)
  )
);

CREATE UNIQUE INDEX communication_sender_address_platform_uq
  ON platform.communication_sender_identities (channel, lower(address))
  WHERE scope = 'PLATFORM';

CREATE UNIQUE INDEX communication_sender_address_tenant_uq
  ON platform.communication_sender_identities (tenant_id, channel, lower(address))
  WHERE scope = 'TENANT';

CREATE UNIQUE INDEX communication_sender_address_organization_uq
  ON platform.communication_sender_identities (
    tenant_id, organization_id, channel, lower(address)
  )
  WHERE scope = 'ORGANIZATION';

CREATE UNIQUE INDEX communication_sender_default_platform_uq
  ON platform.communication_sender_identities (channel)
  WHERE scope = 'PLATFORM' AND is_default AND status = 'ACTIVE';

CREATE UNIQUE INDEX communication_sender_default_tenant_uq
  ON platform.communication_sender_identities (tenant_id, channel)
  WHERE scope = 'TENANT' AND is_default AND status = 'ACTIVE';

CREATE UNIQUE INDEX communication_sender_default_organization_uq
  ON platform.communication_sender_identities (tenant_id, organization_id, channel)
  WHERE scope = 'ORGANIZATION' AND is_default AND status = 'ACTIVE';

CREATE UNIQUE INDEX communication_sender_system_fallback_uq
  ON platform.communication_sender_identities (channel)
  WHERE scope = 'PLATFORM' AND is_system_fallback AND status = 'ACTIVE';

CREATE INDEX communication_sender_resolution_idx
  ON platform.communication_sender_identities (
    channel,
    scope,
    tenant_id,
    organization_id,
    is_default,
    status,
    verification_status
  );

ALTER TABLE platform.communication_sender_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_sender_identities FORCE ROW LEVEL SECURITY;

CREATE POLICY communication_sender_identities_select
  ON platform.communication_sender_identities
  FOR SELECT
  USING (
    scope = 'PLATFORM'
    OR tenant_id = platform.current_tenant_id()
  );

CREATE POLICY communication_sender_identities_insert
  ON platform.communication_sender_identities
  FOR INSERT
  WITH CHECK (
    scope <> 'PLATFORM'
    AND tenant_id = platform.current_tenant_id()
  );

CREATE POLICY communication_sender_identities_update
  ON platform.communication_sender_identities
  FOR UPDATE
  USING (
    scope <> 'PLATFORM'
    AND tenant_id = platform.current_tenant_id()
  )
  WITH CHECK (
    scope <> 'PLATFORM'
    AND tenant_id = platform.current_tenant_id()
  );

CREATE POLICY communication_sender_identities_delete
  ON platform.communication_sender_identities
  FOR DELETE
  USING (
    scope <> 'PLATFORM'
    AND tenant_id = platform.current_tenant_id()
  );

COMMIT;
