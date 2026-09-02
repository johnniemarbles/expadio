BEGIN;

-- Reversible, read-only graph projection. Legacy readers remain unchanged until
-- graph/legacy agreement is proven for each purpose.
CREATE OR REPLACE FUNCTION platform.project_entity_perspective(
  p_tenant_id uuid,
  p_root_entity_type text,
  p_root_entity_id text,
  p_perspective text,
  p_as_of timestamptz DEFAULT now()
)
RETURNS TABLE (
  perspective text,
  entity_type text,
  entity_id text,
  edge_path jsonb,
  effective_from timestamptz,
  source_relationship_id uuid,
  provenance_source text,
  confidence numeric
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, platform
AS $$
  WITH RECURSIVE walk AS (
    SELECT
      r.target_entity_type AS entity_type,
      r.target_entity_id AS entity_id,
      jsonb_build_array(jsonb_build_object(
        'relationshipId', r.relationship_id,
        'relationshipKey', r.relationship_key,
        'sourceType', r.source_entity_type,
        'sourceId', r.source_entity_id,
        'targetType', r.target_entity_type,
        'targetId', r.target_entity_id,
        'validFrom', r.valid_from,
        'provenance', r.provenance_source
      )) AS edge_path,
      r.valid_from AS effective_from,
      r.relationship_id AS source_relationship_id,
      r.provenance_source,
      ARRAY[r.relationship_id::text] AS visited,
      1 AS depth
    FROM platform.entity_relationships r
    JOIN platform.entity_relationship_definitions d
      ON d.definition_id = r.definition_id
    WHERE r.tenant_id = p_tenant_id
      AND r.source_entity_type = p_root_entity_type
      AND r.source_entity_id = p_root_entity_id
      AND d.perspective = p_perspective
      AND r.status = 'ACTIVE'
      AND r.valid_from <= p_as_of
      AND (r.valid_until IS NULL OR r.valid_until > p_as_of)

    UNION ALL

    SELECT
      r.target_entity_type,
      r.target_entity_id,
      w.edge_path || jsonb_build_array(jsonb_build_object(
        'relationshipId', r.relationship_id,
        'relationshipKey', r.relationship_key,
        'sourceType', r.source_entity_type,
        'sourceId', r.source_entity_id,
        'targetType', r.target_entity_type,
        'targetId', r.target_entity_id,
        'validFrom', r.valid_from,
        'provenance', r.provenance_source
      )),
      GREATEST(w.effective_from, r.valid_from),
      w.source_relationship_id,
      CASE WHEN w.provenance_source = 'SYSTEM' THEN 'SYSTEM' ELSE r.provenance_source END,
      w.visited || r.relationship_id::text,
      w.depth + 1
    FROM walk w
    JOIN platform.entity_relationships r
      ON r.tenant_id = p_tenant_id
     AND r.source_entity_type = w.entity_type
     AND r.source_entity_id = w.entity_id
    JOIN platform.entity_relationship_definitions d
      ON d.definition_id = r.definition_id
     AND d.perspective = p_perspective
    WHERE w.depth < 32
      AND r.status = 'ACTIVE'
      AND r.valid_from <= p_as_of
      AND (r.valid_until IS NULL OR r.valid_until > p_as_of)
      AND NOT (r.relationship_id::text = ANY(w.visited))
  )
  SELECT
    p_perspective,
    w.entity_type,
    w.entity_id,
    w.edge_path,
    w.effective_from,
    w.source_relationship_id,
    w.provenance_source,
    CASE w.provenance_source
      WHEN 'SYSTEM' THEN 0.95
      WHEN 'INTEGRATION' THEN 0.85
      WHEN 'IMPORT' THEN 0.75
      WHEN 'PACK' THEN 0.70
      ELSE 0.80
    END::numeric
  FROM walk w;
$$;

COMMENT ON FUNCTION platform.project_entity_perspective IS
  'Purpose-specific effective-dated graph projection with explainable edge paths; safe to disable during migration.';

COMMIT;
