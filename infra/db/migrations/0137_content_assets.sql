BEGIN;

CREATE TABLE IF NOT EXISTS platform.content_assets (
  asset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id),
  organization_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN (
    'LEARNING_CONTENT',
    'LEARNING_SUBMISSION',
    'COMMUNICATION_ATTACHMENT',
    'KNOWLEDGE_SOURCE',
    'DOMAIN_DOCUMENT'
  )),
  filename text NOT NULL CHECK (length(btrim(filename)) BETWEEN 1 AND 500),
  content_type text NOT NULL CHECK (content_type ~ '^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$'),
  byte_length bigint NOT NULL CHECK (byte_length BETWEEN 1 AND 5368709120),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_object_reference text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING_UPLOAD' CHECK (state IN (
    'PENDING_UPLOAD', 'UPLOADED', 'QUARANTINED', 'AVAILABLE', 'REJECTED', 'DELETED'
  )),
  retention_policy_key text NOT NULL,
  retention_policy_version integer NOT NULL CHECK (retention_policy_version > 0),
  required_residency_tags jsonb NOT NULL CHECK (
    jsonb_typeof(required_residency_tags) = 'array'
    AND jsonb_array_length(required_residency_tags) > 0
  ),
  required_compliance_tags jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(required_compliance_tags) = 'array'),
  idempotency_key text NOT NULL,
  created_by_subject_id text NOT NULL,
  correlation_id text NOT NULL,
  rejection_reason_key text,
  available_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_assets_organization_tenant_fk
    FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  CONSTRAINT content_assets_asset_scope_key
    UNIQUE (asset_id, tenant_id, organization_id),
  CONSTRAINT content_assets_tenant_idempotency_key
    UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT content_assets_tenant_object_reference_key
    UNIQUE (tenant_id, storage_object_reference),
  CONSTRAINT content_assets_rejection_reason_check CHECK (
    (state = 'REJECTED' AND rejection_reason_key IS NOT NULL)
    OR (state <> 'REJECTED')
  ),
  CONSTRAINT content_assets_available_at_check CHECK (
    (state = 'AVAILABLE' AND available_at IS NOT NULL)
    OR state <> 'AVAILABLE'
  ),
  CONSTRAINT content_assets_deleted_at_check CHECK (
    (state = 'DELETED' AND deleted_at IS NOT NULL)
    OR state <> 'DELETED'
  )
);

CREATE INDEX IF NOT EXISTS content_assets_scope_created_idx
  ON platform.content_assets (tenant_id, organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_assets_digest_idx
  ON platform.content_assets (tenant_id, sha256)
  WHERE state <> 'DELETED';

CREATE TABLE IF NOT EXISTS platform.content_asset_references (
  reference_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  aggregate_version integer,
  block_id text,
  created_by_subject_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_asset_references_asset_scope_fk
    FOREIGN KEY (asset_id, tenant_id, organization_id)
    REFERENCES platform.content_assets(asset_id, tenant_id, organization_id),
  CONSTRAINT content_asset_references_organization_tenant_fk
    FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id),
  CONSTRAINT content_asset_references_unique_binding
    UNIQUE NULLS NOT DISTINCT (
      tenant_id, asset_id, aggregate_type, aggregate_id, aggregate_version, block_id
    )
);

CREATE INDEX IF NOT EXISTS content_asset_references_asset_idx
  ON platform.content_asset_references (tenant_id, asset_id);

CREATE TABLE IF NOT EXISTS platform.content_asset_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES platform.content_assets(asset_id),
  from_state text,
  to_state text NOT NULL,
  reason_key text NOT NULL,
  actor_subject_id text NOT NULL,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_asset_events_organization_tenant_fk
    FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS content_asset_events_asset_idx
  ON platform.content_asset_events (tenant_id, asset_id, occurred_at);

CREATE OR REPLACE FUNCTION platform.enforce_content_asset_state_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;
  IF NOT (
    CASE OLD.state
      WHEN 'PENDING_UPLOAD' THEN NEW.state IN ('UPLOADED', 'REJECTED', 'DELETED')
      WHEN 'UPLOADED' THEN NEW.state IN ('QUARANTINED', 'REJECTED', 'DELETED')
      WHEN 'QUARANTINED' THEN NEW.state IN ('AVAILABLE', 'REJECTED', 'DELETED')
      WHEN 'AVAILABLE' THEN NEW.state IN ('QUARANTINED', 'DELETED')
      WHEN 'REJECTED' THEN NEW.state = 'DELETED'
      WHEN 'DELETED' THEN false
      ELSE false
    END
  ) THEN
    RAISE EXCEPTION 'CONTENT_ASSET_INVALID_STATE_TRANSITION:%->%', OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS content_assets_state_transition ON platform.content_assets;
CREATE TRIGGER content_assets_state_transition
BEFORE UPDATE OF state ON platform.content_assets
FOR EACH ROW EXECUTE FUNCTION platform.enforce_content_asset_state_transition();

CREATE OR REPLACE FUNCTION platform.enforce_content_asset_immutable_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.storage_object_reference <> OLD.storage_object_reference
     OR NEW.sha256 <> OLD.sha256
     OR NEW.byte_length <> OLD.byte_length
     OR NEW.content_type <> OLD.content_type THEN
    RAISE EXCEPTION 'CONTENT_ASSET_IMMUTABLE_IDENTITY';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS content_assets_immutable_scope ON platform.content_assets;
CREATE TRIGGER content_assets_immutable_scope
BEFORE UPDATE ON platform.content_assets
FOR EACH ROW EXECUTE FUNCTION platform.enforce_content_asset_immutable_scope();

CREATE OR REPLACE FUNCTION platform.prevent_content_asset_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CONTENT_ASSET_EVENTS_APPEND_ONLY';
END
$$;

DROP TRIGGER IF EXISTS content_asset_events_append_only ON platform.content_asset_events;
CREATE TRIGGER content_asset_events_append_only
BEFORE UPDATE OR DELETE ON platform.content_asset_events
FOR EACH ROW EXECUTE FUNCTION platform.prevent_content_asset_event_mutation();

ALTER TABLE platform.content_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.content_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.content_asset_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.content_asset_references FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.content_asset_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.content_asset_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_assets_scope_policy ON platform.content_assets;
CREATE POLICY content_assets_scope_policy ON platform.content_assets
FOR ALL
USING (
  tenant_id = platform.current_tenant_id()
  AND platform.current_context_can_access_organization(tenant_id, organization_id)
)
WITH CHECK (
  tenant_id = platform.current_tenant_id()
  AND platform.current_context_can_access_organization(tenant_id, organization_id)
);

DROP POLICY IF EXISTS content_asset_references_scope_policy ON platform.content_asset_references;
CREATE POLICY content_asset_references_scope_policy ON platform.content_asset_references
FOR ALL
USING (
  tenant_id = platform.current_tenant_id()
  AND platform.current_context_can_access_organization(tenant_id, organization_id)
)
WITH CHECK (
  tenant_id = platform.current_tenant_id()
  AND platform.current_context_can_access_organization(tenant_id, organization_id)
  AND EXISTS (
    SELECT 1 FROM platform.content_assets asset
    WHERE asset.asset_id = content_asset_references.asset_id
      AND asset.tenant_id = content_asset_references.tenant_id
      AND asset.organization_id = content_asset_references.organization_id
  )
);

DROP POLICY IF EXISTS content_asset_events_read_policy ON platform.content_asset_events;
CREATE POLICY content_asset_events_read_policy ON platform.content_asset_events
FOR SELECT
USING (
  tenant_id = platform.current_tenant_id()
  AND platform.current_context_can_access_organization(tenant_id, organization_id)
);

DROP POLICY IF EXISTS content_asset_events_insert_policy ON platform.content_asset_events;
CREATE POLICY content_asset_events_insert_policy ON platform.content_asset_events
FOR INSERT
WITH CHECK (
  tenant_id = platform.current_tenant_id()
  AND platform.current_context_can_access_organization(tenant_id, organization_id)
);

COMMENT ON TABLE platform.content_assets IS
  'Provider-neutral content asset metadata. Object bytes remain behind the governed @expadio/storage gateway.';
COMMENT ON COLUMN platform.content_assets.storage_object_reference IS
  'Opaque gateway object reference; never a public URL or provider credential.';
COMMENT ON TABLE platform.content_asset_references IS
  'Authorized domain bindings proving which immutable aggregate/version/block consumes an asset.';
COMMENT ON TABLE platform.content_asset_events IS
  'Append-only content asset lifecycle evidence.';

COMMIT;
