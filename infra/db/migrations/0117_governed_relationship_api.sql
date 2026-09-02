BEGIN;

ALTER TABLE platform.entity_relationships
  ADD COLUMN IF NOT EXISTS agreement_reference text,
  ADD COLUMN IF NOT EXISTS decision_reference text;

-- Canonical platform vocabulary. Tenant-specific definitions may extend this
-- catalog without changing platform semantics.
INSERT INTO platform.entity_relationship_definitions
  (tenant_id, relationship_key, source_node_type, target_node_type,
   inverse_relationship_key, perspective, cardinality, requires_approval)
VALUES
  (NULL, 'OWNERSHIP', 'LEGAL_ENTITY', 'LEGAL_ENTITY', 'OWNED_BY', 'OWNERSHIP_LEGAL', 'MANY_TO_MANY', true),
  (NULL, 'COMMERCIAL_PARENT', 'OPERATING_UNIT', 'LEGAL_ENTITY', 'COMMERCIAL_CHILD', 'COMMERCIAL', 'MANY_TO_ONE', true),
  (NULL, 'OPERATIONAL_PARENT', 'OPERATING_UNIT', 'OPERATING_UNIT', 'OPERATIONAL_CHILD', 'OPERATIONAL', 'MANY_TO_ONE', true),
  (NULL, 'TERRITORIAL_JURISDICTION', 'OPERATING_UNIT', 'LOCATION', 'TERRITORIAL_UNIT', 'TERRITORY', 'MANY_TO_MANY', true),
  (NULL, 'GOVERNANCE_PARENT', 'OPERATING_UNIT', 'LEGAL_ENTITY', 'GOVERNANCE_CHILD', 'GOVERNANCE', 'MANY_TO_ONE', true),
  (NULL, 'LOCATED_IN', 'LOCATION', 'LOCATION', 'CONTAINS', 'TERRITORY', 'MANY_TO_ONE', false)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION platform.create_governed_entity_relationship(
  p_tenant_id uuid,
  p_source_entity_type text,
  p_source_entity_id text,
  p_relationship_key text,
  p_target_entity_type text,
  p_target_entity_id text,
  p_created_by_subject_id text,
  p_provenance_source text DEFAULT 'USER',
  p_valid_from timestamptz DEFAULT now(),
  p_valid_until timestamptz DEFAULT NULL,
  p_agreement_reference text DEFAULT NULL,
  p_decision_reference text DEFAULT NULL,
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
BEGIN
  IF p_valid_until IS NOT NULL AND p_valid_until <= p_valid_from THEN
    RAISE EXCEPTION 'valid_until must be after valid_from' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_source_entity_id), '') IS NULL
     OR NULLIF(btrim(p_target_entity_id), '') IS NULL
     OR NULLIF(btrim(p_created_by_subject_id), '') IS NULL THEN
    RAISE EXCEPTION 'relationship entity ids and creator are required' USING ERRCODE = '22023';
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
  IF NOT FOUND THEN RAISE EXCEPTION 'relationship definition is not registered' USING ERRCODE = '22023'; END IF;
  IF definition.source_node_type <> p_source_entity_type
     OR definition.target_node_type <> p_target_entity_type THEN
    RAISE EXCEPTION 'relationship endpoints do not match registered definition' USING ERRCODE = '22023';
  END IF;

  IF definition.cardinality IN ('ONE_TO_ONE','MANY_TO_ONE') THEN
    SELECT count(*) INTO conflict_count
      FROM platform.entity_relationships r
     WHERE r.tenant_id = p_tenant_id
       AND r.source_entity_type = p_source_entity_type
       AND r.source_entity_id = p_source_entity_id
       AND r.relationship_key = p_relationship_key
       AND r.status = 'ACTIVE' AND r.valid_until IS NULL
       AND (r.target_entity_type, r.target_entity_id) <>
           (p_target_entity_type, p_target_entity_id);
    IF conflict_count > 0 THEN
      RAISE EXCEPTION 'relationship cardinality violation' USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO platform.entity_relationships (
    tenant_id, source_entity_type, source_entity_id, relationship_key,
    target_entity_type, target_entity_id, valid_from, valid_until,
    attributes, provenance_source, created_by_subject_id,
    agreement_reference, decision_reference
  ) VALUES (
    p_tenant_id, p_source_entity_type, p_source_entity_id, p_relationship_key,
    p_target_entity_type, p_target_entity_id, p_valid_from, p_valid_until,
    p_attributes, p_provenance_source, p_created_by_subject_id,
    p_agreement_reference, p_decision_reference
  ) RETURNING relationship_id INTO new_id;
  RETURN new_id;
END;
$$;

COMMENT ON FUNCTION platform.create_governed_entity_relationship IS
  'Creates a catalog-validated, effective-dated relationship with advisory-lock cardinality enforcement.';

COMMIT;
