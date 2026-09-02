\set ON_ERROR_STOP on

INSERT INTO platform.tenants (
  tenant_id,
  name
) VALUES (
  '58100000-0000-0000-0000-000000000001',
  'Entity Perspective Tenant'
);

DO $$
DECLARE
  perspective_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM platform.entity_relationship_definitions
     WHERE perspective = 'TERRITORY'
  ) THEN
    RAISE EXCEPTION 'legacy TERRITORY perspective remains in catalog';
  END IF;

  SELECT count(DISTINCT perspective)
    INTO perspective_count
    FROM platform.entity_relationship_definitions
   WHERE tenant_id IS NULL
     AND perspective IN (
       'GOVERNANCE',
       'OWNERSHIP_LEGAL',
       'COMMERCIAL',
       'TERRITORY_JURISDICTION',
       'OPERATIONAL'
     );

  IF perspective_count <> 5 THEN
    RAISE EXCEPTION 'expected five canonical relationship perspectives, got %',
      perspective_count;
  END IF;
END;
$$;

SELECT platform.create_governed_entity_relationship(
  '58100000-0000-0000-0000-000000000001',
  'OPERATING_UNIT',
  'operating-unit:ca',
  'GOVERNANCE_PARENT',
  'LEGAL_ENTITY',
  'legal-entity:global-hq',
  'perspective-smoke',
  'SYSTEM'
);

SELECT platform.create_governed_entity_relationship(
  '58100000-0000-0000-0000-000000000001',
  'OPERATING_UNIT',
  'operating-unit:ca',
  'TERRITORIAL_JURISDICTION',
  'LOCATION',
  'territory:ca',
  'perspective-smoke',
  'SYSTEM'
);

-- A historical custom edge deliberately has no governed catalog definition.
INSERT INTO platform.entity_relationships (
  tenant_id,
  source_entity_type,
  source_entity_id,
  relationship_key,
  target_entity_type,
  target_entity_id,
  attributes,
  provenance_source,
  created_by_subject_id
) VALUES (
  '58100000-0000-0000-0000-000000000001',
  'OPERATING_UNIT',
  'operating-unit:ca',
  'LEGACY_CUSTOM_EDGE',
  'EXTERNAL_PARTY',
  'external:legacy',
  '{}'::jsonb,
  'IMPORT',
  'perspective-smoke'
);

DO $$
DECLARE
  governance_count integer;
  territory_count integer;
  unclassified_count integer;
  leaked_count integer;
BEGIN
  SELECT count(*)
    INTO governance_count
    FROM platform.entity_relationships relationship
    JOIN platform.entity_relationship_definitions definition
      ON definition.definition_id = relationship.definition_id
   WHERE relationship.tenant_id =
         '58100000-0000-0000-0000-000000000001'
     AND relationship.status = 'ACTIVE'
     AND definition.perspective = 'GOVERNANCE';

  SELECT count(*)
    INTO territory_count
    FROM platform.entity_relationships relationship
    JOIN platform.entity_relationship_definitions definition
      ON definition.definition_id = relationship.definition_id
   WHERE relationship.tenant_id =
         '58100000-0000-0000-0000-000000000001'
     AND relationship.status = 'ACTIVE'
     AND definition.perspective = 'TERRITORY_JURISDICTION';

  SELECT count(*)
    INTO unclassified_count
    FROM platform.entity_relationships
   WHERE tenant_id = '58100000-0000-0000-0000-000000000001'
     AND definition_id IS NULL
     AND status = 'ACTIVE';

  SELECT count(*)
    INTO leaked_count
    FROM platform.entity_relationships relationship
    JOIN platform.entity_relationship_definitions definition
      ON definition.definition_id = relationship.definition_id
   WHERE relationship.tenant_id =
         '58100000-0000-0000-0000-000000000001'
     AND relationship.relationship_key = 'LEGACY_CUSTOM_EDGE'
     AND definition.perspective IN (
       'GOVERNANCE',
       'OWNERSHIP_LEGAL',
       'COMMERCIAL',
       'TERRITORY_JURISDICTION',
       'OPERATIONAL'
     );

  IF governance_count <> 1 THEN
    RAISE EXCEPTION 'governance projection expected 1 edge, got %',
      governance_count;
  END IF;
  IF territory_count <> 1 THEN
    RAISE EXCEPTION 'territory projection expected 1 edge, got %',
      territory_count;
  END IF;
  IF unclassified_count <> 1 THEN
    RAISE EXCEPTION 'expected one explicit unclassified legacy edge, got %',
      unclassified_count;
  END IF;
  IF leaked_count <> 0 THEN
    RAISE EXCEPTION 'unclassified legacy edge leaked into governed projection';
  END IF;
END;
$$;
