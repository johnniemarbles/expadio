BEGIN;

ALTER TABLE platform.entity_relationships
  ADD COLUMN IF NOT EXISTS source_registry_node_id uuid
    REFERENCES platform.entity_registry_nodes(node_id),
  ADD COLUMN IF NOT EXISTS target_registry_node_id uuid
    REFERENCES platform.entity_registry_nodes(node_id);

CREATE INDEX IF NOT EXISTS entity_relationships_source_registry_node_idx
  ON platform.entity_relationships (tenant_id, source_registry_node_id, status)
  WHERE source_registry_node_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS entity_relationships_target_registry_node_idx
  ON platform.entity_relationships (tenant_id, target_registry_node_id, status)
  WHERE target_registry_node_id IS NOT NULL;

-- Canonical enterprise entities are represented in the registry with their
-- stable UUID string as entity_key. Identity is distinct from lifecycle state.
INSERT INTO platform.entity_registry_nodes (
  tenant_id, node_type, entity_key, display_name, status,
  attributes, provenance_source, created_by_subject_id
)
SELECT
  organization.tenant_id,
  'OPERATING_UNIT',
  organization.organization_id::text,
  organization.name,
  CASE
    WHEN organization.status = 'CLOSED' THEN 'ARCHIVED'
    WHEN organization.status = 'SUSPENDED' THEN 'INACTIVE'
    ELSE 'ACTIVE'
  END,
  jsonb_build_object(
    'sourceTable', 'platform.organizations',
    'enterpriseId', organization.enterprise_id,
    'organizationKind', organization.organization_kind
  ),
  'SYSTEM',
  'entity-registry-backfill'
FROM platform.organizations organization
WHERE NOT EXISTS (
  SELECT 1
    FROM platform.entity_registry_nodes node
   WHERE node.tenant_id = organization.tenant_id
     AND node.node_type = 'OPERATING_UNIT'
     AND node.entity_key = organization.organization_id::text
     AND node.valid_until IS NULL
);

INSERT INTO platform.entity_registry_nodes (
  tenant_id, node_type, entity_key, display_name, status,
  attributes, provenance_source, created_by_subject_id
)
SELECT
  legal_entity.tenant_id,
  'LEGAL_ENTITY',
  legal_entity.legal_entity_id::text,
  legal_entity.legal_name,
  CASE
    WHEN legal_entity.status IN ('REJECTED','INACTIVE') THEN 'INACTIVE'
    ELSE 'ACTIVE'
  END,
  jsonb_build_object(
    'sourceTable', 'platform.legal_entities',
    'enterpriseId', legal_entity.enterprise_id,
    'entityType', legal_entity.entity_type,
    'jurisdictionCountryCode', legal_entity.jurisdiction_country_code
  ),
  'SYSTEM',
  'entity-registry-backfill'
FROM platform.legal_entities legal_entity
WHERE NOT EXISTS (
  SELECT 1
    FROM platform.entity_registry_nodes node
   WHERE node.tenant_id = legal_entity.tenant_id
     AND node.node_type = 'LEGAL_ENTITY'
     AND node.entity_key = legal_entity.legal_entity_id::text
     AND node.valid_until IS NULL
);

INSERT INTO platform.entity_registry_nodes (
  tenant_id, node_type, entity_key, display_name, status,
  attributes, provenance_source, created_by_subject_id
)
SELECT
  territory.tenant_id,
  'LOCATION',
  territory.territory_id::text,
  territory.name,
  CASE WHEN territory.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END,
  jsonb_build_object(
    'sourceTable', 'platform.enterprise_territories',
    'enterpriseId', territory.enterprise_id,
    'territoryKey', territory.territory_key,
    'territoryKind', territory.territory_kind
  ),
  'SYSTEM',
  'entity-registry-backfill'
FROM platform.enterprise_territories territory
WHERE NOT EXISTS (
  SELECT 1
    FROM platform.entity_registry_nodes node
   WHERE node.tenant_id = territory.tenant_id
     AND node.node_type = 'LOCATION'
     AND node.entity_key = territory.territory_id::text
     AND node.valid_until IS NULL
);

CREATE OR REPLACE FUNCTION platform.resolve_or_register_entity_registry_node(
  p_tenant_id uuid,
  p_node_type text,
  p_entity_key text,
  p_actor_subject_id text DEFAULT 'entity-registry-system'
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, platform
AS $$
DECLARE
  resolved_node_id uuid;
  source_display_name text;
  source_status text;
  source_attributes jsonb;
BEGIN
  IF NULLIF(btrim(p_entity_key), '') IS NULL THEN
    RAISE EXCEPTION 'entity registry key is required'
      USING ERRCODE = '22023';
  END IF;

  CASE p_node_type
    WHEN 'OPERATING_UNIT' THEN
      BEGIN
        SELECT
          organization.name,
          CASE
            WHEN organization.status = 'CLOSED' THEN 'ARCHIVED'
            WHEN organization.status = 'SUSPENDED' THEN 'INACTIVE'
            ELSE 'ACTIVE'
          END,
          jsonb_build_object(
            'sourceTable', 'platform.organizations',
            'enterpriseId', organization.enterprise_id,
            'organizationKind', organization.organization_kind
          )
        INTO source_display_name, source_status, source_attributes
        FROM platform.organizations organization
        WHERE organization.tenant_id = p_tenant_id
          AND organization.organization_id = p_entity_key::uuid
        LIMIT 1;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'entity registry operating-unit key must be a UUID'
          USING ERRCODE = '22023';
      END;

    WHEN 'LEGAL_ENTITY' THEN
      BEGIN
        SELECT
          legal_entity.legal_name,
          CASE
            WHEN legal_entity.status IN ('REJECTED','INACTIVE') THEN 'INACTIVE'
            ELSE 'ACTIVE'
          END,
          jsonb_build_object(
            'sourceTable', 'platform.legal_entities',
            'enterpriseId', legal_entity.enterprise_id,
            'entityType', legal_entity.entity_type,
            'jurisdictionCountryCode', legal_entity.jurisdiction_country_code
          )
        INTO source_display_name, source_status, source_attributes
        FROM platform.legal_entities legal_entity
        WHERE legal_entity.tenant_id = p_tenant_id
          AND legal_entity.legal_entity_id = p_entity_key::uuid
        LIMIT 1;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'entity registry legal-entity key must be a UUID'
          USING ERRCODE = '22023';
      END;

    WHEN 'LOCATION' THEN
      BEGIN
        SELECT
          territory.name,
          CASE WHEN territory.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END,
          jsonb_build_object(
            'sourceTable', 'platform.enterprise_territories',
            'enterpriseId', territory.enterprise_id,
            'territoryKey', territory.territory_key,
            'territoryKind', territory.territory_kind
          )
        INTO source_display_name, source_status, source_attributes
        FROM platform.enterprise_territories territory
        WHERE territory.tenant_id = p_tenant_id
          AND territory.territory_id = p_entity_key::uuid
        LIMIT 1;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'entity registry location key must be a UUID'
          USING ERRCODE = '22023';
      END;

    ELSE
      SELECT node.node_id, node.status
        INTO resolved_node_id, source_status
        FROM platform.entity_registry_nodes node
       WHERE node.tenant_id = p_tenant_id
         AND node.node_type = p_node_type
         AND node.entity_key = p_entity_key
         AND node.valid_until IS NULL
       ORDER BY node.created_at DESC, node.node_id DESC
       LIMIT 1;

      IF resolved_node_id IS NULL THEN
        RAISE EXCEPTION 'ENTITY_REGISTRY_NODE_NOT_FOUND'
          USING ERRCODE = '23503';
      END IF;
      IF source_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'ENTITY_REGISTRY_NODE_INACTIVE'
          USING ERRCODE = '23514';
      END IF;
      RETURN resolved_node_id;
  END CASE;

  IF source_display_name IS NULL THEN
    RAISE EXCEPTION 'ENTITY_REGISTRY_NODE_NOT_FOUND'
      USING ERRCODE = '23503';
  END IF;
  IF source_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'ENTITY_REGISTRY_NODE_INACTIVE'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO platform.entity_registry_nodes (
    tenant_id, node_type, entity_key, display_name, status,
    attributes, provenance_source, created_by_subject_id
  ) VALUES (
    p_tenant_id, p_node_type, p_entity_key, source_display_name, 'ACTIVE',
    source_attributes, 'SYSTEM', p_actor_subject_id
  )
  ON CONFLICT (tenant_id, node_type, entity_key)
    WHERE status = 'ACTIVE' AND valid_until IS NULL
  DO UPDATE SET
    display_name = EXCLUDED.display_name,
    attributes = EXCLUDED.attributes,
    updated_by_subject_id = EXCLUDED.created_by_subject_id,
    updated_at = now()
  RETURNING node_id INTO resolved_node_id;

  RETURN resolved_node_id;
END;
$$;

-- Classified governed edges must be anchored to real registry nodes going
-- forward. NOT VALID preserves historical rows that predate the registry.
ALTER TABLE platform.entity_relationships
  ADD CONSTRAINT entity_relationships_classified_registry_nodes_required
  CHECK (
    definition_id IS NULL
    OR (
      source_registry_node_id IS NOT NULL
      AND target_registry_node_id IS NOT NULL
    )
  ) NOT VALID;

-- Backfill registry links for already classified relationships where both
-- canonical nodes are known.
UPDATE platform.entity_relationships relationship
   SET source_registry_node_id = source_node.node_id,
       target_registry_node_id = target_node.node_id
  FROM platform.entity_relationship_definitions definition,
       platform.entity_registry_nodes source_node,
       platform.entity_registry_nodes target_node
 WHERE relationship.definition_id = definition.definition_id
   AND relationship.tenant_id = source_node.tenant_id
   AND relationship.tenant_id = target_node.tenant_id
   AND source_node.node_type = relationship.source_entity_type
   AND source_node.entity_key = relationship.source_entity_id
   AND source_node.status = 'ACTIVE'
   AND source_node.valid_until IS NULL
   AND target_node.node_type = relationship.target_entity_type
   AND target_node.entity_key = relationship.target_entity_id
   AND target_node.status = 'ACTIVE'
   AND target_node.valid_until IS NULL
   AND (
     relationship.source_registry_node_id IS NULL
     OR relationship.target_registry_node_id IS NULL
   );

CREATE OR REPLACE FUNCTION platform.create_governed_entity_relationship(
  p_tenant_id uuid, p_source_entity_type text, p_source_entity_id text,
  p_relationship_key text, p_target_entity_type text, p_target_entity_id text,
  p_created_by_subject_id text, p_provenance_source text DEFAULT 'USER',
  p_valid_from timestamptz DEFAULT now(), p_valid_until timestamptz DEFAULT NULL,
  p_agreement_reference text DEFAULT NULL, p_decision_reference text DEFAULT NULL,
  p_attributes jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, platform
AS $$
DECLARE
  definition platform.entity_relationship_definitions%ROWTYPE;
  new_id uuid;
  conflict_count integer;
  source_node_id uuid;
  target_node_id uuid;
BEGIN
  IF p_valid_until IS NOT NULL AND p_valid_until <= p_valid_from THEN
    RAISE EXCEPTION 'valid_until must be after valid_from'
      USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_source_entity_id), '') IS NULL
     OR NULLIF(btrim(p_target_entity_id), '') IS NULL
     OR NULLIF(btrim(p_created_by_subject_id), '') IS NULL THEN
    RAISE EXCEPTION 'relationship entity ids and creator are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text || '|' || p_source_entity_type || '|' ||
    p_source_entity_id || '|' || p_relationship_key, 0));

  SELECT d.* INTO definition
    FROM platform.entity_relationship_definitions d
   WHERE d.relationship_key = p_relationship_key
     AND (d.tenant_id = p_tenant_id OR d.tenant_id IS NULL)
     AND d.status = 'ACTIVE'
   ORDER BY (d.tenant_id IS NULL)
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'relationship definition is not registered'
      USING ERRCODE = '22023';
  END IF;
  IF definition.source_node_type <> p_source_entity_type
     OR definition.target_node_type <> p_target_entity_type THEN
    RAISE EXCEPTION 'relationship endpoints do not match registered definition'
      USING ERRCODE = '22023';
  END IF;

  source_node_id := platform.resolve_or_register_entity_registry_node(
    p_tenant_id,
    p_source_entity_type,
    p_source_entity_id,
    p_created_by_subject_id
  );
  target_node_id := platform.resolve_or_register_entity_registry_node(
    p_tenant_id,
    p_target_entity_type,
    p_target_entity_id,
    p_created_by_subject_id
  );

  IF definition.cardinality IN ('ONE_TO_ONE','MANY_TO_ONE') THEN
    SELECT count(*) INTO conflict_count
      FROM platform.entity_relationships r
     WHERE r.tenant_id = p_tenant_id
       AND r.source_entity_type = p_source_entity_type
       AND r.source_entity_id = p_source_entity_id
       AND r.relationship_key = p_relationship_key
       AND r.status = 'ACTIVE'
       AND r.valid_until IS NULL
       AND (r.target_entity_type, r.target_entity_id) <>
           (p_target_entity_type, p_target_entity_id);

    IF conflict_count > 0 THEN
      RAISE EXCEPTION 'relationship cardinality violation'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO platform.entity_relationships (
    tenant_id, definition_id,
    source_registry_node_id, target_registry_node_id,
    source_entity_type, source_entity_id, relationship_key,
    target_entity_type, target_entity_id, valid_from, valid_until, attributes,
    provenance_source, created_by_subject_id,
    agreement_reference, decision_reference
  ) VALUES (
    p_tenant_id, definition.definition_id,
    source_node_id, target_node_id,
    p_source_entity_type, p_source_entity_id,
    p_relationship_key, p_target_entity_type, p_target_entity_id,
    p_valid_from, p_valid_until, p_attributes,
    p_provenance_source, p_created_by_subject_id,
    p_agreement_reference, p_decision_reference
  )
  RETURNING relationship_id INTO new_id;

  RETURN new_id;
END;
$$;

COMMENT ON FUNCTION platform.resolve_or_register_entity_registry_node IS
  'Resolves a tenant-scoped registry node, lazily registering canonical organization/legal-entity/territory endpoints only after proving the underlying entity exists and is usable.';

COMMENT ON COLUMN platform.entity_relationships.source_registry_node_id IS
  'Registry anchor for governed classified source endpoints; NULL only for legacy/unclassified relationships.';

COMMENT ON COLUMN platform.entity_relationships.target_registry_node_id IS
  'Registry anchor for governed classified target endpoints; NULL only for legacy/unclassified relationships.';

COMMIT;
