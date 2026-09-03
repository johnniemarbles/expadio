BEGIN;

-- 0128 made platform.entity_relationships.relationship_type mandatory, but the
-- enterprise publication helper from 0120 still inserted only relationship_key.
-- Recreate the helper after the governed taxonomy migration so derived
-- enterprise edges are classified with the registered governed relationship type.
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
  existing_id uuid;
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

  SELECT relationship_id
    INTO existing_id
    FROM platform.entity_relationships
   WHERE tenant_id = p_tenant_id
     AND source_entity_type = p_source_entity_type
     AND source_entity_id = p_source_entity_id
     AND relationship_key = p_relationship_key
     AND target_entity_type = p_target_entity_type
     AND target_entity_id = p_target_entity_id
     AND relationship_type = definition.relationship_key
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
       AND r.relationship_type = definition.relationship_key
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
    source_node_id, target_node_id,
    source_node_id, target_node_id,
    p_source_entity_type, p_source_entity_id, p_relationship_key, definition.relationship_key,
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
