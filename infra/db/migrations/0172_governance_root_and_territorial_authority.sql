-- 0172_governance_root_and_territorial_authority.sql
-- Ascending counterparts to the descending closure functions in migration
-- 0131 (platform.governance_closure, platform.territorial_closure, etc).
-- Those answer "what does this authority govern?"; these answer "who governs
-- this node?" -- needed to route a staged action to the right approver under
-- a resolved publishing policy (see platform.resolve_publishing_policy(),
-- migration 0171).
--
-- Edge direction is unchanged from 0131: a GOVERNANCE_PARENT or
-- TERRITORIAL_JURISDICTION row has source_node_id = the authority,
-- target_node_id = the governed/territorial child.

BEGIN;

-- Walks GOVERNANCE_PARENT edges upward from p_node_id to the topmost node
-- with no further GOVERNANCE_PARENT. Returns p_node_id itself if it has none.
CREATE OR REPLACE FUNCTION platform.governance_root(p_node_id uuid)
RETURNS uuid
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
  SELECT node_id FROM up_chain ORDER BY depth DESC LIMIT 1;
$$;

COMMENT ON FUNCTION platform.governance_root(uuid) IS
  'Returns the topmost node reached by walking GOVERNANCE_PARENT edges upward '
  'from p_node_id (self if it has no governance parent). Used to route a '
  'COUNTRY_BRAND_MANDATORY approval to the ultimate governance authority.';

-- Returns the direct TERRITORIAL_JURISDICTION authority over p_node_id, or
-- NULL if none is configured. Mirrors platform.territorial_closure()'s
-- direction (0131) but looks up from the governed node to its authority
-- instead of from the authority down to its governed nodes.
CREATE OR REPLACE FUNCTION platform.territorial_authority(p_node_id uuid)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = pg_catalog, platform
AS $$
  SELECT r.source_node_id
  FROM platform.entity_relationships r
  WHERE r.target_node_id    = p_node_id
    AND r.relationship_type = 'TERRITORIAL_JURISDICTION'
    AND r.effective_to      IS NULL
  LIMIT 1;
$$;

COMMENT ON FUNCTION platform.territorial_authority(uuid) IS
  'Returns the node holding TERRITORIAL_JURISDICTION over p_node_id, or NULL '
  'if none is configured. Used to route a STATE_MASTER_SIGN_OFF approval.';

COMMIT;
