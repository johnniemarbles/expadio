BEGIN;

-- Graph reads stay opt-in per tenant. There is intentionally no tenant write
-- policy: rollout is a platform-governed operation after compatibility proof.
CREATE TABLE platform.entity_graph_read_controls (
  tenant_id uuid PRIMARY KEY REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  graph_reads_enabled boolean NOT NULL DEFAULT false,
  drift_checked_at timestamptz,
  drift_free_at timestamptz,
  updated_by_subject_id text NOT NULL CHECK (btrim(updated_by_subject_id) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (drift_free_at IS NULL OR drift_checked_at IS NOT NULL),
  CHECK (NOT graph_reads_enabled OR drift_free_at IS NOT NULL)
);

ALTER TABLE platform.entity_graph_read_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.entity_graph_read_controls FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_graph_read_controls_tenant_select
  ON platform.entity_graph_read_controls
  FOR SELECT
  USING (tenant_id = platform.current_tenant_id());

CREATE OR REPLACE FUNCTION platform.entity_graph_reads_enabled(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, platform
AS $$
  SELECT COALESCE((
    SELECT control.graph_reads_enabled
      FROM platform.entity_graph_read_controls control
     WHERE control.tenant_id = p_tenant_id
  ), false)
$$;

-- Compare the current operational graph to the retained organization closure
-- compatibility model. Empty output is the cutover proof for this perspective.
CREATE OR REPLACE FUNCTION platform.compare_operational_graph_to_legacy(
  p_tenant_id uuid,
  p_as_of timestamptz DEFAULT now()
)
RETURNS TABLE (
  tenant_id uuid,
  descendant_organization_id uuid,
  ancestor_organization_id uuid,
  legacy_depth integer,
  graph_depth integer,
  drift_kind text
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, platform
AS $$
  WITH RECURSIVE graph_walk AS (
    SELECT
      relationship.tenant_id,
      source_org.organization_id AS descendant_organization_id,
      target_org.organization_id AS ancestor_organization_id,
      1 AS depth,
      ARRAY[source_org.organization_id, target_org.organization_id]::uuid[] AS visited
    FROM platform.entity_relationships relationship
    JOIN platform.entity_relationship_definitions definition
      ON definition.definition_id = relationship.definition_id
     AND definition.relationship_key = 'OPERATIONAL_PARENT'
     AND definition.perspective = 'OPERATIONAL'
    JOIN platform.organizations source_org
      ON source_org.tenant_id = relationship.tenant_id
     AND source_org.organization_id::text = relationship.source_entity_id
    JOIN platform.organizations target_org
      ON target_org.tenant_id = relationship.tenant_id
     AND target_org.organization_id::text = relationship.target_entity_id
    WHERE relationship.tenant_id = p_tenant_id
      AND relationship.status = 'ACTIVE'
      AND relationship.valid_from <= p_as_of
      AND (relationship.valid_until IS NULL OR relationship.valid_until > p_as_of)
      AND source_org.status NOT IN ('SUSPENDED','CLOSED')
      AND target_org.status NOT IN ('SUSPENDED','CLOSED')

    UNION ALL

    SELECT
      walk.tenant_id,
      walk.descendant_organization_id,
      target_org.organization_id,
      walk.depth + 1,
      walk.visited || target_org.organization_id
    FROM graph_walk walk
    JOIN platform.entity_relationships relationship
      ON relationship.tenant_id = walk.tenant_id
     AND relationship.source_entity_type = 'OPERATING_UNIT'
     AND relationship.source_entity_id = walk.ancestor_organization_id::text
     AND relationship.relationship_key = 'OPERATIONAL_PARENT'
    JOIN platform.entity_relationship_definitions definition
      ON definition.definition_id = relationship.definition_id
     AND definition.perspective = 'OPERATIONAL'
    JOIN platform.organizations target_org
      ON target_org.tenant_id = relationship.tenant_id
     AND target_org.organization_id::text = relationship.target_entity_id
    WHERE walk.depth < 32
      AND relationship.status = 'ACTIVE'
      AND relationship.valid_from <= p_as_of
      AND (relationship.valid_until IS NULL OR relationship.valid_until > p_as_of)
      AND target_org.status NOT IN ('SUSPENDED','CLOSED')
      AND NOT target_org.organization_id = ANY(walk.visited)
  ),
  graph_pairs AS (
    SELECT
      walk.tenant_id,
      walk.descendant_organization_id,
      walk.ancestor_organization_id,
      min(walk.depth)::integer AS depth
    FROM graph_walk walk
    GROUP BY
      walk.tenant_id,
      walk.descendant_organization_id,
      walk.ancestor_organization_id
  ),
  legacy_pairs AS (
    SELECT
      closure.tenant_id,
      closure.descendant_organization_id,
      closure.ancestor_organization_id,
      closure.depth
    FROM platform.organization_closure closure
    JOIN platform.organizations descendant
      ON descendant.tenant_id = closure.tenant_id
     AND descendant.organization_id = closure.descendant_organization_id
    JOIN platform.organizations ancestor
      ON ancestor.tenant_id = closure.tenant_id
     AND ancestor.organization_id = closure.ancestor_organization_id
    WHERE closure.tenant_id = p_tenant_id
      AND closure.depth > 0
      AND descendant.status NOT IN ('SUSPENDED','CLOSED')
      AND ancestor.status NOT IN ('SUSPENDED','CLOSED')
  )
  SELECT
    COALESCE(legacy.tenant_id, graph.tenant_id),
    COALESCE(legacy.descendant_organization_id, graph.descendant_organization_id),
    COALESCE(legacy.ancestor_organization_id, graph.ancestor_organization_id),
    legacy.depth,
    graph.depth,
    CASE
      WHEN legacy.tenant_id IS NULL THEN 'GRAPH_ONLY'
      WHEN graph.tenant_id IS NULL THEN 'LEGACY_ONLY'
      ELSE 'DEPTH_MISMATCH'
    END
  FROM legacy_pairs legacy
  FULL OUTER JOIN graph_pairs graph
    ON graph.tenant_id = legacy.tenant_id
   AND graph.descendant_organization_id = legacy.descendant_organization_id
   AND graph.ancestor_organization_id = legacy.ancestor_organization_id
  WHERE legacy.tenant_id IS NULL
     OR graph.tenant_id IS NULL
     OR legacy.depth <> graph.depth;
$$;

COMMENT ON TABLE platform.entity_graph_read_controls IS
  'Platform-governed, tenant-specific graph cutover switch; disabled is the compatibility rollback.';
COMMENT ON FUNCTION platform.compare_operational_graph_to_legacy IS
  'Returns graph-versus-closure drift; no rows means the current operational projection agrees with the legacy compatibility model.';

COMMIT;
