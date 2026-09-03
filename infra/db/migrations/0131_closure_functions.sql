-- ============================================================================
-- 0124_closure_functions.sql
-- Entity Graph Phase 5 — purpose-specific closure projections.
--
-- platform.organization_closure is preserved unchanged as a compatibility
-- read model for all existing queries. These four functions are additive.
--
-- Each function traverses a different relationship type through the entity
-- graph. The caller specifies which purpose they are evaluating; the function
-- returns only the nodes reachable via that edge type.
--
-- Why functions rather than materialized views initially:
--   · No refresh scheduling complexity while the graph is still being populated.
--   · Functions are always current (no stale-read window).
--   · They become materialized views in Phase 5 once the entity graph is the
--     authoritative source and query volume justifies it.
--
-- Why purpose-specific, not generic:
--   A STATE_MASTER node has territorial jurisdiction over units in its state.
--   A MULTI_UNIT operator has commercial authority over its fleet.
--   These are different questions and produce different answer sets.
--   A single "get all descendants" function conflates them and cannot be used
--   safely in an authorization predicate.
--
-- All four functions are STABLE (no side effects, same result within a
-- transaction for the same inputs). They respect RLS because they query
-- entity_relationships and entity_nodes, both of which have RLS enabled.
-- ============================================================================

BEGIN;

-- ── 1. Governance closure ───────────────────────────────────────────────────
-- Traverses GOVERNANCE_PARENT edges upward to find the governance root,
-- and GOVERNANCE_PARENT edges downward to find all governed descendants.
--
-- Usage: "Can the Brand HQ authority see this node?"
--   SELECT * FROM platform.governance_closure('brand-hq-node-id')
--   WHERE node_id = 'target-node-id'
--
-- Returns all nodes for which root_node_id is the governance ancestor.

CREATE OR REPLACE FUNCTION platform.governance_closure(p_root_node_id uuid)
RETURNS TABLE (
  node_id      uuid,
  depth        integer,
  path         uuid[],
  node_type    text,
  display_name text
)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE gov_tree AS (
    -- Seed: the root node itself (depth 0)
    SELECT
      n.node_id,
      0                  AS depth,
      ARRAY[n.node_id]   AS path,
      n.node_type,
      n.display_name
    FROM platform.entity_nodes n
    WHERE n.node_id = p_root_node_id
      AND n.status  = 'ACTIVE'

    UNION ALL

    -- Recurse: nodes whose GOVERNANCE_PARENT is already in the tree
    SELECT
      child.node_id,
      tree.depth + 1,
      tree.path || child.node_id,
      child.node_type,
      child.display_name
    FROM gov_tree tree
    JOIN platform.entity_relationships r
      ON  r.source_node_id    = tree.node_id
      AND r.relationship_type = 'GOVERNANCE_PARENT'
      AND r.effective_to      IS NULL
    JOIN platform.entity_nodes child
      ON  child.node_id = r.target_node_id
      AND child.status  = 'ACTIVE'
    -- Cycle guard: do not revisit a node already in the path.
    WHERE child.node_id <> ALL(tree.path)
  )
  SELECT node_id, depth, path, node_type, display_name
  FROM gov_tree
  ORDER BY depth, display_name;
$$;

COMMENT ON FUNCTION platform.governance_closure(uuid) IS
  'Returns all entity nodes for which p_root_node_id is the governance ancestor '
  '(via GOVERNANCE_PARENT edges). Used to answer: "what can this governance authority see?"';

-- ── 2. Commercial closure ───────────────────────────────────────────────────
-- Traverses COMMERCIAL_PARENT edges to find a multi-unit operator's fleet.
--
-- Usage: "What units does this MULTI_UNIT operator control commercially?"

CREATE OR REPLACE FUNCTION platform.commercial_closure(p_root_node_id uuid)
RETURNS TABLE (
  node_id      uuid,
  depth        integer,
  path         uuid[],
  node_type    text,
  display_name text
)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE comm_tree AS (
    SELECT
      n.node_id,
      0                  AS depth,
      ARRAY[n.node_id]   AS path,
      n.node_type,
      n.display_name
    FROM platform.entity_nodes n
    WHERE n.node_id = p_root_node_id
      AND n.status  = 'ACTIVE'

    UNION ALL

    SELECT
      child.node_id,
      tree.depth + 1,
      tree.path || child.node_id,
      child.node_type,
      child.display_name
    FROM comm_tree tree
    JOIN platform.entity_relationships r
      ON  r.source_node_id    = tree.node_id
      AND r.relationship_type = 'COMMERCIAL_PARENT'
      AND r.effective_to      IS NULL
    JOIN platform.entity_nodes child
      ON  child.node_id = r.target_node_id
      AND child.status  = 'ACTIVE'
    WHERE child.node_id <> ALL(tree.path)
  )
  SELECT node_id, depth, path, node_type, display_name
  FROM comm_tree
  ORDER BY depth, display_name;
$$;

COMMENT ON FUNCTION platform.commercial_closure(uuid) IS
  'Returns all entity nodes in the commercial fleet of p_root_node_id '
  '(via COMMERCIAL_PARENT edges). Used to answer: "what units does this operator own?"';

-- ── 3. Territorial closure ──────────────────────────────────────────────────
-- Finds all nodes under the territorial jurisdiction of a given authority.
-- Unlike governance and commercial, territorial jurisdiction is not a tree —
-- it is a set of TERRITORIAL_JURISDICTION edges pointing to an authority.
-- The function returns all nodes that name p_authority_node_id as their
-- territorial jurisdiction holder.
--
-- Usage: "What units are in this State Master's territory?"

CREATE OR REPLACE FUNCTION platform.territorial_closure(p_authority_node_id uuid)
RETURNS TABLE (
  node_id      uuid,
  node_type    text,
  display_name text,
  effective_from date
)
LANGUAGE sql STABLE AS $$
  SELECT
    n.node_id,
    n.node_type,
    n.display_name,
    r.effective_from
  FROM platform.entity_relationships r
  JOIN platform.entity_nodes n
    ON  n.node_id = r.target_node_id
    AND n.status  = 'ACTIVE'
  WHERE r.source_node_id    = p_authority_node_id
    AND r.relationship_type = 'TERRITORIAL_JURISDICTION'
    AND r.effective_to      IS NULL
  ORDER BY n.display_name;
$$;

COMMENT ON FUNCTION platform.territorial_closure(uuid) IS
  'Returns all entity nodes under the territorial jurisdiction of p_authority_node_id '
  '(direct TERRITORIAL_JURISDICTION edges). State Master → its units.';

-- ── 4. Operational closure ──────────────────────────────────────────────────
-- Traverses OPERATIONAL_PARENT edges. Useful for operational reporting trees
-- that may differ from commercial structure.
--
-- Usage: "What nodes report operationally to this entity?"

CREATE OR REPLACE FUNCTION platform.operational_closure(p_root_node_id uuid)
RETURNS TABLE (
  node_id      uuid,
  depth        integer,
  path         uuid[],
  node_type    text,
  display_name text
)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE ops_tree AS (
    SELECT
      n.node_id,
      0                  AS depth,
      ARRAY[n.node_id]   AS path,
      n.node_type,
      n.display_name
    FROM platform.entity_nodes n
    WHERE n.node_id = p_root_node_id
      AND n.status  = 'ACTIVE'

    UNION ALL

    SELECT
      child.node_id,
      tree.depth + 1,
      tree.path || child.node_id,
      child.node_type,
      child.display_name
    FROM ops_tree tree
    JOIN platform.entity_relationships r
      ON  r.source_node_id    = tree.node_id
      AND r.relationship_type = 'OPERATIONAL_PARENT'
      AND r.effective_to      IS NULL
    JOIN platform.entity_nodes child
      ON  child.node_id = r.target_node_id
      AND child.status  = 'ACTIVE'
    WHERE child.node_id <> ALL(tree.path)
  )
  SELECT node_id, depth, path, node_type, display_name
  FROM ops_tree
  ORDER BY depth, display_name;
$$;

COMMENT ON FUNCTION platform.operational_closure(uuid) IS
  'Returns all entity nodes in the operational reporting tree of p_root_node_id '
  '(via OPERATIONAL_PARENT edges).';

-- ── 5. Isolation proof helper (for integration tests) ──────────────────────
-- Used by the CI soak test to assert that two unrelated nodes cannot see
-- each other through any closure function.
-- Returns TRUE if the candidate node is reachable from root via the given
-- relationship type. Used as a negative assertion: must return FALSE for
-- sibling/unrelated nodes.

CREATE OR REPLACE FUNCTION platform.node_is_reachable(
  p_root_node_id      uuid,
  p_candidate_node_id uuid,
  p_relationship_type text  -- 'GOVERNANCE' | 'COMMERCIAL' | 'OPERATIONAL'
)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM (
      SELECT node_id FROM platform.governance_closure(p_root_node_id)
        WHERE p_relationship_type = 'GOVERNANCE'
      UNION ALL
      SELECT node_id FROM platform.commercial_closure(p_root_node_id)
        WHERE p_relationship_type = 'COMMERCIAL'
      UNION ALL
      SELECT node_id FROM platform.operational_closure(p_root_node_id)
        WHERE p_relationship_type = 'OPERATIONAL'
    ) reachable
    WHERE node_id = p_candidate_node_id
  );
$$;

COMMIT;
