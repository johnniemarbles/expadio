\set ON_ERROR_STOP on

INSERT INTO platform.tenants (
  tenant_id,
  name
) VALUES (
  '60100000-0000-0000-0000-000000000001',
  'Enterprise Graph Publication Tenant'
);

INSERT INTO platform.organizations (
  organization_id, tenant_id, enterprise_id, parent_organization_id,
  organization_kind, name, status
)
SELECT
  '60100000-0000-0000-0000-000000000011',
  profile.tenant_id,
  profile.enterprise_id,
  NULL,
  'BUSINESS',
  'Graph Parent',
  'ACTIVE'
FROM platform.enterprise_profiles profile
WHERE profile.tenant_id = '60100000-0000-0000-0000-000000000001'
ORDER BY profile.created_at
LIMIT 1;

INSERT INTO platform.organizations (
  organization_id, tenant_id, enterprise_id, parent_organization_id,
  organization_kind, name, status
)
SELECT
  '60100000-0000-0000-0000-000000000012',
  profile.tenant_id,
  profile.enterprise_id,
  '60100000-0000-0000-0000-000000000011',
  'BUSINESS',
  'Graph Child',
  'CONFIGURING'
FROM platform.enterprise_profiles profile
WHERE profile.tenant_id = '60100000-0000-0000-0000-000000000001'
ORDER BY profile.created_at
LIMIT 1;

INSERT INTO platform.legal_entities (
  legal_entity_id, tenant_id, enterprise_id, legal_name, entity_type,
  jurisdiction_country_code, status, verified_at, created_by_subject_id
)
SELECT
  '60100000-0000-0000-0000-000000000021',
  profile.tenant_id,
  profile.enterprise_id,
  'Graph Operating Company',
  'CORPORATION',
  'CA',
  'VERIFIED',
  now(),
  'graph-publication-smoke'
FROM platform.enterprise_profiles profile
WHERE profile.tenant_id = '60100000-0000-0000-0000-000000000001'
ORDER BY profile.created_at
LIMIT 1;

INSERT INTO platform.enterprise_territories (
  territory_id, tenant_id, enterprise_id, territory_key, name,
  territory_kind, country_code, status, created_by_subject_id
)
SELECT
  '60100000-0000-0000-0000-000000000031',
  profile.tenant_id,
  profile.enterprise_id,
  'ca',
  'Canada',
  'COUNTRY',
  'CA',
  'ACTIVE',
  'graph-publication-smoke'
FROM platform.enterprise_profiles profile
WHERE profile.tenant_id = '60100000-0000-0000-0000-000000000001'
ORDER BY profile.created_at
LIMIT 1;

SELECT set_config(
  'app.tenant_id',
  '60100000-0000-0000-0000-000000000001',
  false
);

DO $$
DECLARE
  first_id uuid;
  replay_id uuid;
  edge_count integer;
  operational_count integer;
  territory_count integer;
BEGIN
  first_id := platform.create_governed_entity_relationship(
    '60100000-0000-0000-0000-000000000001',
    'OPERATING_UNIT',
    '60100000-0000-0000-0000-000000000012',
    'OPERATIONAL_PARENT',
    'OPERATING_UNIT',
    '60100000-0000-0000-0000-000000000011',
    'graph-publication-smoke',
    'SYSTEM'
  );
  replay_id := platform.create_governed_entity_relationship(
    '60100000-0000-0000-0000-000000000001',
    'OPERATING_UNIT',
    '60100000-0000-0000-0000-000000000012',
    'OPERATIONAL_PARENT',
    'OPERATING_UNIT',
    '60100000-0000-0000-0000-000000000011',
    'graph-publication-smoke',
    'SYSTEM'
  );

  IF first_id <> replay_id THEN
    RAISE EXCEPTION 'exact relationship replay did not reuse the same edge';
  END IF;

  PERFORM platform.create_governed_entity_relationship(
    '60100000-0000-0000-0000-000000000001',
    'OPERATING_UNIT',
    '60100000-0000-0000-0000-000000000012',
    'OPERATED_BY',
    'LEGAL_ENTITY',
    '60100000-0000-0000-0000-000000000021',
    'graph-publication-smoke',
    'SYSTEM'
  );

  PERFORM platform.create_governed_entity_relationship(
    '60100000-0000-0000-0000-000000000001',
    'OPERATING_UNIT',
    '60100000-0000-0000-0000-000000000012',
    'TERRITORIAL_JURISDICTION',
    'LOCATION',
    '60100000-0000-0000-0000-000000000031',
    'graph-publication-smoke',
    'SYSTEM'
  );

  SELECT count(*)
    INTO edge_count
    FROM platform.entity_relationships
   WHERE tenant_id = '60100000-0000-0000-0000-000000000001'
     AND source_entity_id = '60100000-0000-0000-0000-000000000012'
     AND relationship_key IN (
       'OPERATIONAL_PARENT',
       'OPERATED_BY',
       'TERRITORIAL_JURISDICTION'
     )
     AND status = 'ACTIVE'
     AND valid_until IS NULL;

  SELECT count(*)
    INTO operational_count
    FROM platform.entity_relationships relationship
    JOIN platform.entity_relationship_definitions definition
      ON definition.definition_id = relationship.definition_id
   WHERE relationship.tenant_id = '60100000-0000-0000-0000-000000000001'
     AND relationship.source_entity_id = '60100000-0000-0000-0000-000000000012'
     AND definition.perspective = 'OPERATIONAL';

  SELECT count(*)
    INTO territory_count
    FROM platform.entity_relationships relationship
    JOIN platform.entity_relationship_definitions definition
      ON definition.definition_id = relationship.definition_id
   WHERE relationship.tenant_id = '60100000-0000-0000-0000-000000000001'
     AND relationship.source_entity_id = '60100000-0000-0000-0000-000000000012'
     AND definition.perspective = 'TERRITORY_JURISDICTION';

  IF edge_count <> 3 THEN
    RAISE EXCEPTION 'expected exactly three active derived edges, got %', edge_count;
  END IF;
  IF operational_count <> 2 THEN
    RAISE EXCEPTION 'expected two operational perspective edges, got %', operational_count;
  END IF;
  IF territory_count <> 1 THEN
    RAISE EXCEPTION 'expected one territory perspective edge, got %', territory_count;
  END IF;
END;
$$;
