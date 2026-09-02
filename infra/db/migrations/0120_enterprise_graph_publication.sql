BEGIN;

INSERT INTO platform.entity_relationship_definitions (
  tenant_id,
  relationship_key,
  source_node_type,
  target_node_type,
  inverse_relationship_key,
  perspective,
  cardinality,
  requires_approval,
  status,
  created_by_subject_id
) VALUES (
  NULL,
  'OPERATED_BY',
  'OPERATING_UNIT',
  'LEGAL_ENTITY',
  'OPERATES',
  'OPERATIONAL',
  'MANY_TO_ONE',
  false,
  'ACTIVE',
  'platform'
)
ON CONFLICT DO NOTHING;

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
     AND status = 'ACTIVE'
     AND valid_until IS NULL
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

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT
      child.tenant_id,
      child.organization_id AS source_id,
      child.parent_organization_id AS target_id
    FROM platform.organizations child
    JOIN platform.organizations parent
      ON parent.tenant_id = child.tenant_id
     AND parent.organization_id = child.parent_organization_id
    WHERE child.parent_organization_id IS NOT NULL
      AND child.status NOT IN ('SUSPENDED','CLOSED')
      AND parent.status NOT IN ('SUSPENDED','CLOSED')
  LOOP
    PERFORM platform.create_governed_entity_relationship(
      item.tenant_id,
      'OPERATING_UNIT',
      item.source_id::text,
      'OPERATIONAL_PARENT',
      'OPERATING_UNIT',
      item.target_id::text,
      'enterprise-graph-backfill',
      'SYSTEM',
      now(),
      NULL,
      NULL,
      'backfill:organization-parent',
      jsonb_build_object('source', 'platform.organizations')
    );
  END LOOP;

  FOR item IN
    SELECT DISTINCT ON (binding.tenant_id, binding.organization_id)
      binding.tenant_id,
      binding.organization_id AS source_id,
      binding.legal_entity_id AS target_id,
      binding.organization_legal_entity_binding_id AS binding_id,
      binding.valid_from
    FROM platform.organization_legal_entity_bindings binding
    JOIN platform.organizations organization
      ON organization.tenant_id = binding.tenant_id
     AND organization.organization_id = binding.organization_id
    JOIN platform.legal_entities legal_entity
      ON legal_entity.tenant_id = binding.tenant_id
     AND legal_entity.legal_entity_id = binding.legal_entity_id
    WHERE binding.binding_role = 'OPERATED_BY'
      AND binding.status = 'ACTIVE'
      AND binding.valid_from <= now()
      AND (binding.valid_until IS NULL OR binding.valid_until > now())
      AND organization.status NOT IN ('SUSPENDED','CLOSED')
      AND legal_entity.status = 'VERIFIED'
      AND legal_entity.valid_from <= now()
      AND (legal_entity.valid_until IS NULL OR legal_entity.valid_until > now())
    ORDER BY
      binding.tenant_id,
      binding.organization_id,
      binding.valid_from DESC,
      binding.organization_legal_entity_binding_id DESC
  LOOP
    PERFORM platform.create_governed_entity_relationship(
      item.tenant_id,
      'OPERATING_UNIT',
      item.source_id::text,
      'OPERATED_BY',
      'LEGAL_ENTITY',
      item.target_id::text,
      'enterprise-graph-backfill',
      'SYSTEM',
      item.valid_from,
      NULL,
      NULL,
      'backfill:organization-operating-entity',
      jsonb_build_object(
        'source', 'platform.organization_legal_entity_bindings',
        'bindingId', item.binding_id
      )
    );
  END LOOP;

  FOR item IN
    SELECT
      activation.tenant_id,
      activation.organization_id AS source_id,
      activation.territory_id AS target_id,
      activation.enterprise_jurisdiction_activation_id AS activation_id,
      activation.workflow_activation_id,
      activation.activated_at
    FROM platform.enterprise_jurisdiction_activations activation
    JOIN platform.organizations organization
      ON organization.tenant_id = activation.tenant_id
     AND organization.organization_id = activation.organization_id
    JOIN platform.enterprise_territories territory
      ON territory.tenant_id = activation.tenant_id
     AND territory.territory_id = activation.territory_id
    WHERE activation.state = 'ACTIVE'
      AND activation.activated_at IS NOT NULL
      AND organization.status NOT IN ('SUSPENDED','CLOSED')
      AND territory.status = 'ACTIVE'
  LOOP
    PERFORM platform.create_governed_entity_relationship(
      item.tenant_id,
      'OPERATING_UNIT',
      item.source_id::text,
      'TERRITORIAL_JURISDICTION',
      'LOCATION',
      item.target_id::text,
      'enterprise-graph-backfill',
      'SYSTEM',
      item.activated_at,
      NULL,
      NULL,
      CASE
        WHEN item.workflow_activation_id IS NULL THEN 'backfill:jurisdiction-activation'
        ELSE 'workflow-activation:' || item.workflow_activation_id::text
      END,
      jsonb_build_object(
        'source', 'platform.enterprise_jurisdiction_activations',
        'jurisdictionActivationId', item.activation_id
      )
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION platform.create_governed_entity_relationship IS
  'Creates or idempotently reuses a catalog-validated, registry-anchored, effective-dated relationship with advisory-lock cardinality enforcement.';

COMMENT ON COLUMN platform.entity_relationship_definitions.requires_approval IS
  'Metadata declaring whether a direct relationship mutation requires approval. Derived projections published from already-governed source transactions may use definitions where this is false.';

COMMIT;
