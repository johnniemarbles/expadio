-- 0170_entity_governance_config.sql
-- Per-node content publishing policy, resolved by inheritance up the
-- GOVERNANCE_PARENT chain in platform.entity_relationships (Entity Graph
-- Phase 2, migration 0121/0128). A BRAND_HQ or COUNTRY node sets an explicit
-- policy; descendant nodes with no explicit policy of their own inherit the
-- nearest configured ancestor's policy.
--
-- Edge direction (confirmed against platform.governance_closure(), 0131):
-- a GOVERNANCE_PARENT row has source_node_id = the governing authority and
-- target_node_id = the governed child. Walking upward from a node therefore
-- joins on target_node_id = <current node> to read off source_node_id as
-- its immediate governance parent.

BEGIN;

DO $$ BEGIN
    CREATE TYPE platform.content_publishing_policy AS ENUM (
        'DIRECT_AUTONOMOUS',
        'LOCAL_ADMIN_SIGN_OFF',
        'STATE_MASTER_SIGN_OFF',
        'COUNTRY_BRAND_MANDATORY'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE platform.entity_governance_config (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES platform.entity_nodes(node_id) ON DELETE CASCADE,
  publishing_policy platform.content_publishing_policy NOT NULL DEFAULT 'COUNTRY_BRAND_MANDATORY',
  updated_by text NOT NULL CHECK (btrim(updated_by) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, node_id)
);

CREATE INDEX entity_governance_config_tenant_idx
  ON platform.entity_governance_config (tenant_id);

ALTER TABLE platform.entity_governance_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.entity_governance_config FORCE ROW LEVEL SECURITY;

CREATE POLICY entity_governance_config_select ON platform.entity_governance_config
  FOR SELECT USING (tenant_id = platform.current_tenant_id());
CREATE POLICY entity_governance_config_insert ON platform.entity_governance_config
  FOR INSERT WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY entity_governance_config_update ON platform.entity_governance_config
  FOR UPDATE USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

-- Resolves the effective publishing policy for a node: walks GOVERNANCE_PARENT
-- edges upward starting at the node itself, and returns the nearest ancestor
-- (including the node itself, at depth 0) that has an explicit config row.
-- Returns NULL if no ancestor in the chain has configured a policy — callers
-- should treat NULL as the system default (COUNTRY_BRAND_MANDATORY).
CREATE OR REPLACE FUNCTION platform.resolve_publishing_policy(
  p_tenant_id uuid,
  p_node_id uuid
) RETURNS platform.content_publishing_policy
LANGUAGE sql STABLE
SET search_path = pg_catalog, platform
AS $$
  WITH RECURSIVE up_chain AS (
    SELECT p_node_id AS node_id, 0 AS depth

    UNION ALL

    SELECT r.source_node_id, uc.depth + 1
    FROM up_chain uc
    JOIN platform.entity_relationships r
      ON  r.target_node_id    = uc.node_id
      AND r.relationship_type = 'GOVERNANCE_PARENT'
      AND r.effective_to      IS NULL
    WHERE uc.depth < 32 -- cycle/runaway guard; governance chains are shallow in practice
  )
  SELECT egc.publishing_policy
  FROM up_chain uc
  JOIN platform.entity_governance_config egc
    ON egc.node_id = uc.node_id AND egc.tenant_id = p_tenant_id
  ORDER BY uc.depth ASC
  LIMIT 1;
$$;

COMMENT ON FUNCTION platform.resolve_publishing_policy(uuid, uuid) IS
  'Walks GOVERNANCE_PARENT edges upward from p_node_id (self first) and returns '
  'the nearest ancestor''s explicit publishing_policy, or NULL if none is configured.';

COMMIT;
