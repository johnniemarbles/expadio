-- ============================================================================
-- 0120_entity_nodes.sql
-- Entity Graph Phase 1 — the typed actor registry.
--
-- Every participant in a commercial, territorial, governance, or geographic
-- relationship is an entity node. A node is NOT an organization: it has no
-- memberships, no Clerk group binding, and no workspace semantics.
--
-- platform.organizations continues to be the authorization and workspace
-- boundary. Entity nodes are parallel first-class objects that carry the
-- commercial and territorial meaning that organizations must not carry.
--
-- Node types are check-constrained text, not a PostgreSQL enum, so adding a
-- new type is a migration that changes a constraint, not a DDL operation that
-- blocks the table.
-- ============================================================================

BEGIN;

CREATE TABLE platform.entity_nodes (
  node_id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,

  -- The type is immutable after creation. A UNIT cannot become a COUNTRY.
  -- Changing the type of a node is a new node + relationship edge, not an UPDATE.
  node_type        text        NOT NULL CHECK (node_type IN (
    'BRAND_HQ',        -- root franchisor / brand authority for this tenant
    'COUNTRY',         -- country-level master entity (may hold development rights)
    'STATE_MASTER',    -- state/province development rights holder
    'MULTI_UNIT',      -- multi-unit operator (commercial fleet owner)
    'UNIT',            -- individual operating location / franchise unit
    'LEGAL_ENTITY',    -- incorporated business (holds contracts, has registration)
    'LOCATION',        -- physical site with address and geography
    'JV_PARTNER'       -- joint venture participant (economic interest only)
  )),

  display_name     text        NOT NULL CHECK (btrim(display_name) <> ''),

  -- Stable external reference (ERP ID, legal registration ref, franchisor code).
  -- Not a credential. Not an authorization input. Provenance only.
  external_ref     text,

  -- Optional link back to an organization for nodes that also have a workspace.
  -- A BRAND_HQ node often corresponds to the tenant's root organization.
  -- A UNIT node may or may not have a corresponding workspace organization.
  -- NULL is valid: most operational nodes have no workspace.
  organization_id  uuid,

  status           text        NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'DISSOLVED')),

  -- DISSOLVED is terminal. A dissolved node cannot be reactivated.
  -- Dissolution must carry when and by whom.
  dissolved_at     timestamptz,
  dissolved_by     text,

  metadata         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by       text        NOT NULL CHECK (btrim(created_by) <> ''),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CHECK (
    (status = 'DISSOLVED' AND dissolved_at IS NOT NULL AND dissolved_by IS NOT NULL)
    OR (status <> 'DISSOLVED' AND dissolved_at IS NULL AND dissolved_by IS NULL)
  ),
  UNIQUE (node_id, tenant_id)

);

-- One BRAND_HQ per tenant. A tenant cannot have two root brand authorities.
CREATE UNIQUE INDEX entity_nodes_brand_hq_unique_idx
  ON platform.entity_nodes (tenant_id)
  WHERE node_type = 'BRAND_HQ' AND status = 'ACTIVE';

-- Fast lookup by organization binding (for resolving "what entity is this org?").
CREATE INDEX entity_nodes_organization_idx
  ON platform.entity_nodes (organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX entity_nodes_tenant_type_idx
  ON platform.entity_nodes (tenant_id, node_type, status);

CREATE INDEX entity_nodes_external_ref_idx
  ON platform.entity_nodes (tenant_id, external_ref)
  WHERE external_ref IS NOT NULL;

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE platform.entity_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.entity_nodes FORCE ROW LEVEL SECURITY;

CREATE POLICY entity_nodes_select
  ON platform.entity_nodes
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY entity_nodes_insert
  ON platform.entity_nodes
  FOR INSERT WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY entity_nodes_update
  ON platform.entity_nodes
  FOR UPDATE USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

-- Nodes are never hard-deleted. Dissolution is a status transition.
-- The DELETE policy exists to satisfy the constraint that every non-superuser
-- table with RLS has explicit policies for every operation — it denies all deletes.
CREATE POLICY entity_nodes_no_delete
  ON platform.entity_nodes
  FOR DELETE USING (false);

-- ── Immutability: node_type cannot change after creation ───────────────────
CREATE OR REPLACE FUNCTION platform.reject_entity_node_type_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.node_type <> OLD.node_type THEN
    RAISE EXCEPTION
      'entity_nodes.node_type is immutable after creation. '
      'To change an entity''s type, dissolve this node and create a new one.';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER entity_nodes_immutable_type
BEFORE UPDATE ON platform.entity_nodes
FOR EACH ROW EXECUTE FUNCTION platform.reject_entity_node_type_change();

COMMIT;
