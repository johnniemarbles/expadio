BEGIN;

-- 0128 made platform.entity_relationships.relationship_type mandatory and added
-- FKs to platform.entity_nodes, but the enterprise publication helper from
-- 0120/0119 still resolved only platform.entity_registry_nodes. Recreate the
-- helper after the governed taxonomy migration so derived enterprise edges keep
-- their registry anchors while also writing real governed entity-node anchors.
CREATE OR REPLACE FUNCTION platform.resolve_or_register_governed_entity_node(
  p_tenant_id uuid,
  p_registry_node_type text,
  p_entity_key text,
  p_actor_subject_id text DEFAULT 'entity-graph-system'
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, platform
AS $$
DECLARE
  resolved_node_id uuid;
  governed_node_type text;
  source_display_name text;
  source_organization_id uuid;
  source_status text;
  source_attributes jsonb;
BEGIN
  IF NULLIF(btrim(p_entity_key), '') IS NULL THEN
    RAISE EXCEPTION 'governed entity node key is required'
      USING ERRCODE = '22023';
  END IF;

  CASE p_registry_node_type
    WHEN 'OPERATING_UNIT' THEN
      governed_node_type := 'UNIT';
      BEGIN
        SELECT
          organization.name,
          organization.organization_id,
          CASE
            WHEN organization.status IN ('CLOSED','SUSPENDED') THEN 'INACTIVE'
            ELSE 'ACTIVE'
          END,
          jsonb_build_object(
            'sourceTable', 'platform.organizations',
            'enterpriseId', organization.enterprise_id,
            'organizationKind', organization.organization_kind,
            'registryNodeType', p_registry_node_type,
            'entityKey', p_entity_key
          )
        INTO source_display_name, source_organization_id, source_status, source_attributes
        FROM platform.organizations organization
        WHERE organization.tenant_id = p_tenant_id
          AND organization.organization_id = p_entity_key::uuid
        LIMIT 1;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'governed operating-unit key must be a UUID'
          USING ERRCODE = '22023';
      END;

      IF source_organization_id IS NULL THEN
        RAISE EXCEPTION 'GOVERNED_ENTITY_NODE_NOT_FOUND'
          USING ERRCODE = '23503';
      END IF;

      SELECT node.node_id INTO resolved_node_id
        FROM platform.entity_nodes node
       WHERE node.tenant_id = p_tenant_id
         AND node.organization_id = source_organization_id
         AND node.status <> 'DISSOLVED'
       ORDER BY node.created_at DESC, node.node_id DESC
       LIMIT 1;

    WHEN 'LEGAL_ENTITY' THEN
      governed_node_type := 'LEGAL_ENTITY';
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
            'jurisdictionCountryCode', legal_entity.jurisdiction_country_code,
            'registryNodeType', p_registry_node_type,
            'entityKey', p_entity_key
          )
        INTO source_display_name, source_status, source_attributes
        FROM platform.legal_entities legal_entity
        WHERE legal_entity.tenant_id = p_tenant_id
          AND legal_entity.legal_entity_id = p_entity_key::uuid
        LIMIT 1;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'governed legal-entity key must be a UUID'
          USING ERRCODE = '22023';
      END;

      SELECT node.node_id INTO resolved_node_id
        FROM platform.entity_nodes node
       WHERE node.tenant_id = p_tenant_id
         AND node.node_type = governed_node_type
         AND node.external_ref = p_entity_key
         AND node.status <> 'DISSOLVED'
       ORDER BY node.created_at DESC, node.node_id DESC
       LIMIT 1;

    WHEN 'LOCATION' THEN
      governed_node_type := 'LOCATION';
      BEGIN
        SELECT
          territory.name,
          CASE WHEN territory.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END,
          jsonb_build_object(
            'sourceTable', 'platform.enterprise_territories',
            'enterpriseId', territory.enterprise_id,
            'territoryKey', territory.territory_key,
            'territoryKind', territory.territory_kind,
            'registryNodeType', p_registry_node_type,
            'entityKey', p_entity_key
          )
        INTO source_display_name, source_status, source_attributes
        FROM platform.enterprise_territories territory
        WHERE territory.tenant_id = p_tenant_id
          AND territory.territory_id = p_entity_key::uuid
        LIMIT 1;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'governed location key must be a UUID'
          USING ERRCODE = '22023';
      END;

      SELECT node.node_id INTO resolved_node_id
        FROM platform.entity_nodes node
       WHERE node.tenant_id = p_tenant_id
         AND node.node_type = governed_node_type
         AND node.external_ref = p_entity_key
         AND node.status <> 'DISSOLVED'
       ORDER BY node.created_at DESC, node.node_id DESC
       LIMIT 1;

    ELSE
      RAISE EXCEPTION 'GOVERNED_ENTITY_NODE_TYPE_NOT_SUPPORTED'
        USING ERRCODE = '23503';
  END CASE;

  IF source_display_name IS NULL THEN
    RAISE EXCEPTION 'GOVERNED_ENTITY_NODE_NOT_FOUND'
      USING ERRCODE = '23503';
  END IF;
  IF source_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'GOVERNED_ENTITY_NODE_INACTIVE'
      USING ERRCODE = '23514';
  END IF;
  IF resolved_node_id IS NOT NULL THEN
    RETURN resolved_node_id;
  END IF;

  INSERT INTO platform.entity_nodes (
    tenant_id, node_type, display_name, external_ref, organization_id,
    status, metadata, created_by
  ) VALUES (
    p_tenant_id, governed_node_type, source_display_name, p_entity_key, source_organization_id,
    'ACTIVE', source_attributes, p_actor_subject_id
  )
  RETURNING node_id INTO resolved_node_id;

  RETURN resolved_node_id;
END;
$$;

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
  governed_relationship_type text;
  existing_id uuid;
  new_id uuid;
  conflict_count integer;
  source_registry_node_id uuid;
  target_registry_node_id uuid;
  source_governed_node_id uuid;
  target_governed_node_id uuid;
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

  governed_relationship_type := CASE
    WHEN definition.relationship_key IN ('COMMERCIAL_PARENT') THEN 'COMMERCIAL_PARENT'
    WHEN definition.relationship_key IN ('OPERATIONAL_PARENT','OPERATED_BY','OPERATES') THEN 'OPERATIONAL_PARENT'
    WHEN definition.relationship_key IN ('TERRITORIAL_JURISDICTION','LOCATED_IN','CONTAINS') THEN CASE
      WHEN definition.relationship_key = 'LOCATED_IN' THEN 'LOCATED_IN'
      ELSE 'TERRITORIAL_JURISDICTION'
    END
    WHEN definition.relationship_key IN ('GOVERNANCE_PARENT') THEN 'GOVERNANCE_PARENT'
    WHEN definition.relationship_key IN (
      'OWNERSHIP','CONTROLLING_OWNERSHIP','MINORITY_OWNERSHIP','BENEFICIAL_OWNERSHIP'
    ) THEN 'OWNERSHIP'
    ELSE 'LEGACY'
  END;

  source_registry_node_id := platform.resolve_or_register_entity_registry_node(
    p_tenant_id, p_source_entity_type, p_source_entity_id, p_created_by_subject_id
  );
  target_registry_node_id := platform.resolve_or_register_entity_registry_node(
    p_tenant_id, p_target_entity_type, p_target_entity_id, p_created_by_subject_id
  );
  source_governed_node_id := platform.resolve_or_register_governed_entity_node(
    p_tenant_id, p_source_entity_type, p_source_entity_id, p_created_by_subject_id
  );
  target_governed_node_id := platform.resolve_or_register_governed_entity_node(
    p_tenant_id, p_target_entity_type, p_target_entity_id, p_created_by_subject_id
  );

  SELECT relationship_id
    INTO existing_id
    FROM platform.entity_relationships
   WHERE tenant_id = p_tenant_id
     AND source_entity_type = p_source_entity_type
     AND source_entity_id = p_source_entity_id
     AND relationship_key = p_relationship_key
     AND target_entity_type = p_target_entity_type
     AND target_entity_id = p_target_entity_id
     AND relationship_type = governed_relationship_type
     AND status = 'ACTIVE'
     AND valid_until IS NULL
     AND effective_to IS NULL
   ORDER BY valid_from DESC, relationship_id DESC
   LIMIT 1;

  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  IF definition.cardinality IN ('ONE_TO_ONE','MANY_TO_ONE') THEN
    SELECT count(*) INTO conflict_count
      FROM platform.entity_relationships r
     WHERE r.tenant_id = p_tenant_id
       AND r.source_entity_type = p_source_entity_type
       AND r.source_entity_id = p_source_entity_id
       AND r.relationship_key = p_relationship_key
       AND r.relationship_type = governed_relationship_type
       AND r.status = 'ACTIVE'
       AND r.valid_until IS NULL
       AND r.effective_to IS NULL
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
    source_node_id, target_node_id,
    source_entity_type, source_entity_id, relationship_key, relationship_type,
    target_entity_type, target_entity_id, valid_from, valid_until,
    effective_from, effective_to, attributes,
    provenance_source, created_by_subject_id,
    agreement_reference, decision_reference
  ) VALUES (
    p_tenant_id, definition.definition_id,
    source_registry_node_id, target_registry_node_id,
    source_governed_node_id, target_governed_node_id,
    p_source_entity_type, p_source_entity_id, p_relationship_key, governed_relationship_type,
    p_target_entity_type, p_target_entity_id, p_valid_from, p_valid_until,
    p_valid_from::date, CASE WHEN p_valid_until IS NULL THEN NULL ELSE p_valid_until::date END,
    p_attributes,
    p_provenance_source, p_created_by_subject_id,
    p_agreement_reference, p_decision_reference
  )
  RETURNING relationship_id INTO new_id;

  RETURN new_id;
END;
$$;

COMMIT;
