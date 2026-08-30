BEGIN;

-- Relationship Fabric
--
-- Authoritative business relationships live here. Workflow participants are
-- derived/projection records and must never replace this business-domain edge.
--
-- Entity IDs are text deliberately: many platform entities are UUID-backed,
-- while IAM subjects and external parties use stable non-UUID identifiers.

CREATE TABLE platform.entity_relationships (
  relationship_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,

  source_entity_type text NOT NULL CHECK (btrim(source_entity_type) <> ''),
  source_entity_id text NOT NULL CHECK (btrim(source_entity_id) <> ''),
  relationship_key text NOT NULL CHECK (btrim(relationship_key) <> ''),

  target_entity_type text NOT NULL CHECK (btrim(target_entity_type) <> ''),
  target_entity_id text NOT NULL CHECK (btrim(target_entity_id) <> ''),

  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
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

-- Prevent duplicate simultaneously-active identical edges while still keeping
-- historical rows for reassignment. Cardinality across *different* targets is
-- enforced by the governed repository using a transaction-scoped advisory lock.
CREATE UNIQUE INDEX entity_relationships_active_edge_uniq
  ON platform.entity_relationships (
    tenant_id,
    source_entity_type,
    source_entity_id,
    relationship_key,
    target_entity_type,
    target_entity_id
  )
  WHERE status = 'ACTIVE' AND valid_until IS NULL;

CREATE INDEX entity_relationships_source_lookup_idx
  ON platform.entity_relationships (
    tenant_id,
    source_entity_type,
    source_entity_id,
    relationship_key,
    status
  );

CREATE INDEX entity_relationships_target_lookup_idx
  ON platform.entity_relationships (
    tenant_id,
    target_entity_type,
    target_entity_id,
    relationship_key,
    status
  );

ALTER TABLE platform.entity_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.entity_relationships FORCE ROW LEVEL SECURITY;

CREATE POLICY entity_relationships_tenant_all
  ON platform.entity_relationships
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
