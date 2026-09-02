BEGIN;

-- Brand-neutral entity registry. A node is the stable identity shared by
-- governance, ownership/legal, commercial, territory and operations views.
CREATE TABLE platform.entity_registry_nodes (
  node_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  node_type text NOT NULL CHECK (node_type IN (
    'ROOT','LEGAL_ENTITY','OPERATING_UNIT','PERSON','EXTERNAL_PARTY',
    'ASSET','LOCATION','BRAND'
  )),
  entity_key text NOT NULL CHECK (btrim(entity_key) <> ''),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','INACTIVE','ARCHIVED')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(attributes) = 'object'),
  provenance_source text NOT NULL DEFAULT 'USER'
    CHECK (provenance_source IN ('USER','SYSTEM','PACK','IMPORT','INTEGRATION')),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  updated_by_subject_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE UNIQUE INDEX entity_registry_nodes_active_key_uniq
  ON platform.entity_registry_nodes (tenant_id, node_type, entity_key)
  WHERE status = 'ACTIVE' AND valid_until IS NULL;
CREATE INDEX entity_registry_nodes_tenant_type_idx
  ON platform.entity_registry_nodes (tenant_id, node_type, status);
ALTER TABLE platform.entity_registry_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.entity_registry_nodes FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_registry_nodes_tenant_all
  ON platform.entity_registry_nodes FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

-- Platform-owned relationship vocabulary with tenant-scoped extensions.
CREATE TABLE platform.entity_relationship_definitions (
  definition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  relationship_key text NOT NULL CHECK (btrim(relationship_key) <> ''),
  source_node_type text NOT NULL CHECK (btrim(source_node_type) <> ''),
  target_node_type text NOT NULL CHECK (btrim(target_node_type) <> ''),
  inverse_relationship_key text,
  perspective text NOT NULL CHECK (perspective IN (
    'GOVERNANCE','OWNERSHIP_LEGAL','COMMERCIAL','TERRITORY','OPERATIONAL'
  )),
  cardinality text NOT NULL CHECK (cardinality IN (
    'ONE_TO_ONE','ONE_TO_MANY','MANY_TO_ONE','MANY_TO_MANY'
  )),
  requires_approval boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','INACTIVE')),
  attributes_schema jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(attributes_schema) = 'object'),
  created_by_subject_id text NOT NULL DEFAULT 'platform'
    CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, relationship_key)
);
CREATE UNIQUE INDEX entity_relationship_definitions_platform_key_uniq
  ON platform.entity_relationship_definitions (relationship_key)
  WHERE tenant_id IS NULL;
CREATE INDEX entity_relationship_definitions_lookup_idx
  ON platform.entity_relationship_definitions (tenant_id, source_node_type, target_node_type, status);
ALTER TABLE platform.entity_relationship_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.entity_relationship_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_relationship_definitions_tenant_read
  ON platform.entity_relationship_definitions FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = platform.current_tenant_id());

-- Add a nullable catalog link so existing relationship rows remain compatible.
ALTER TABLE platform.entity_relationships
  ADD COLUMN IF NOT EXISTS definition_id uuid
    REFERENCES platform.entity_relationship_definitions(definition_id);
CREATE INDEX IF NOT EXISTS entity_relationships_definition_idx
  ON platform.entity_relationships (tenant_id, definition_id)
  WHERE definition_id IS NOT NULL;

-- Normalized, effective-dated ownership/economic interests. Approval is
-- explicit so later workflows can enforce four-eyes separation of duties.
CREATE TABLE platform.entity_ownership_interests (
  interest_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  owner_node_id uuid NOT NULL REFERENCES platform.entity_registry_nodes(node_id) ON DELETE CASCADE,
  subject_node_id uuid NOT NULL REFERENCES platform.entity_registry_nodes(node_id) ON DELETE CASCADE,
  interest_type text NOT NULL CHECK (interest_type IN (
    'EQUITY','VOTING','ECONOMIC','CONTROL','BENEFICIAL'
  )),
  percentage numeric(7,4) CHECK (percentage IS NULL OR percentage >= 0 AND percentage <= 100),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPROVED','REJECTED','SUPERSEDED')),
  provenance_source text NOT NULL DEFAULT 'USER'
    CHECK (provenance_source IN ('USER','SYSTEM','PACK','IMPORT','INTEGRATION')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence) = 'object'),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  approved_by_subject_id text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (owner_node_id <> subject_node_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK ((status = 'APPROVED') = (approved_by_subject_id IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (approved_by_subject_id IS NULL OR approved_by_subject_id <> created_by_subject_id)
);
CREATE INDEX entity_ownership_interests_subject_idx
  ON platform.entity_ownership_interests (tenant_id, subject_node_id, interest_type, status);
CREATE INDEX entity_ownership_interests_owner_idx
  ON platform.entity_ownership_interests (tenant_id, owner_node_id, interest_type, status);
ALTER TABLE platform.entity_ownership_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.entity_ownership_interests FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_ownership_interests_tenant_all
  ON platform.entity_ownership_interests FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMENT ON TABLE platform.entity_registry_nodes IS
  'Brand-neutral entity identities projected into five governed perspectives.';
COMMENT ON TABLE platform.entity_relationship_definitions IS
  'Platform relationship catalog; tenants may add scoped definitions without changing platform semantics.';
COMMENT ON TABLE platform.entity_ownership_interests IS
  'Effective-dated ownership and control interests with explicit four-eyes approval metadata.';

COMMIT;
