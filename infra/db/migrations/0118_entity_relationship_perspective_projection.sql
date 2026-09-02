BEGIN;

-- Canonicalize the fifth relationship perspective. The TypeScript contract,
-- architecture language and operator UX use TERRITORY_JURISDICTION; the first
-- catalog migration used TERRITORY. Keep one name everywhere.
ALTER TABLE platform.entity_relationship_definitions
  DROP CONSTRAINT IF EXISTS entity_relationship_definitions_perspective_check;

UPDATE platform.entity_relationship_definitions
   SET perspective = 'TERRITORY_JURISDICTION'
 WHERE perspective = 'TERRITORY';

ALTER TABLE platform.entity_relationship_definitions
  ADD CONSTRAINT entity_relationship_definitions_perspective_check
  CHECK (perspective IN (
    'GOVERNANCE',
    'OWNERSHIP_LEGAL',
    'COMMERCIAL',
    'TERRITORY_JURISDICTION',
    'OPERATIONAL'
  ));

CREATE INDEX IF NOT EXISTS entity_relationship_definitions_perspective_lookup_idx
  ON platform.entity_relationship_definitions (
    tenant_id,
    perspective,
    source_node_type,
    target_node_type,
    status
  );

-- Link legacy relationship rows only when the catalog can prove the matching
-- definition from key + endpoint types. Tenant-specific definitions win over
-- platform defaults. Unknown legacy edges remain intentionally unclassified.
UPDATE platform.entity_relationships relationship
   SET definition_id = (
     SELECT definition.definition_id
       FROM platform.entity_relationship_definitions definition
      WHERE definition.relationship_key = relationship.relationship_key
        AND definition.source_node_type = relationship.source_entity_type
        AND definition.target_node_type = relationship.target_entity_type
        AND definition.status = 'ACTIVE'
        AND (
          definition.tenant_id = relationship.tenant_id
          OR definition.tenant_id IS NULL
        )
      ORDER BY
        CASE WHEN definition.tenant_id = relationship.tenant_id THEN 0 ELSE 1 END,
        definition.created_at,
        definition.definition_id
      LIMIT 1
   )
 WHERE relationship.definition_id IS NULL
   AND EXISTS (
     SELECT 1
       FROM platform.entity_relationship_definitions definition
      WHERE definition.relationship_key = relationship.relationship_key
        AND definition.source_node_type = relationship.source_entity_type
        AND definition.target_node_type = relationship.target_entity_type
        AND definition.status = 'ACTIVE'
        AND (
          definition.tenant_id = relationship.tenant_id
          OR definition.tenant_id IS NULL
        )
   );

CREATE INDEX IF NOT EXISTS entity_relationships_active_definition_lookup_idx
  ON platform.entity_relationships (
    tenant_id,
    definition_id,
    source_entity_type,
    source_entity_id,
    status
  )
  WHERE definition_id IS NOT NULL;

COMMENT ON COLUMN platform.entity_relationships.definition_id IS
  'Authoritative relationship classification. NULL means legacy/unclassified and is excluded from perspective projections until governed classification exists.';

COMMIT;
