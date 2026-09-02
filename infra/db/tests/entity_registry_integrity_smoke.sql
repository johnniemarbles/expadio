\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('59100000-0000-0000-0000-000000000001', 'Registry Integrity Tenant A'),
  ('59100000-0000-0000-0000-000000000002', 'Registry Integrity Tenant B');

INSERT INTO platform.organizations (
  organization_id, tenant_id, enterprise_id, name, organization_kind, status
)
SELECT
  '59100000-0000-0000-0000-000000000011',
  profile.tenant_id,
  profile.enterprise_id,
  'Registry Org A',
  'BUSINESS',
  'ACTIVE'
FROM platform.enterprise_profiles profile
WHERE profile.tenant_id = '59100000-0000-0000-0000-000000000001'
ORDER BY profile.created_at
LIMIT 1;

INSERT INTO platform.legal_entities (
  legal_entity_id, tenant_id, enterprise_id, legal_name, entity_type,
  jurisdiction_country_code, status, verified_at, created_by_subject_id
)
SELECT
  '59100000-0000-0000-0000-000000000021',
  profile.tenant_id,
  profile.enterprise_id,
  'Registry Legal A',
  'CORPORATION',
  'CA',
  'VERIFIED',
  now(),
  'registry-smoke'
FROM platform.enterprise_profiles profile
WHERE profile.tenant_id = '59100000-0000-0000-0000-000000000001'
ORDER BY profile.created_at
LIMIT 1;

INSERT INTO platform.legal_entities (
  legal_entity_id, tenant_id, enterprise_id, legal_name, entity_type,
  jurisdiction_country_code, status, verified_at, created_by_subject_id
)
SELECT
  '59100000-0000-0000-0000-000000000022',
  profile.tenant_id,
  profile.enterprise_id,
  'Registry Legal B',
  'CORPORATION',
  'US',
  'VERIFIED',
  now(),
  'registry-smoke'
FROM platform.enterprise_profiles profile
WHERE profile.tenant_id = '59100000-0000-0000-0000-000000000002'
ORDER BY profile.created_at
LIMIT 1;

INSERT INTO platform.enterprise_territories (
  territory_id, tenant_id, enterprise_id, territory_key, name,
  territory_kind, country_code, status, created_by_subject_id
)
SELECT
  '59100000-0000-0000-0000-000000000031',
  profile.tenant_id,
  profile.enterprise_id,
  'ca',
  'Canada',
  'COUNTRY',
  'CA',
  'ACTIVE',
  'registry-smoke'
FROM platform.enterprise_profiles profile
WHERE profile.tenant_id = '59100000-0000-0000-0000-000000000001'
ORDER BY profile.created_at
LIMIT 1;

SELECT set_config(
  'app.tenant_id',
  '59100000-0000-0000-0000-000000000001',
  false
);

SELECT platform.create_governed_entity_relationship(
  '59100000-0000-0000-0000-000000000001',
  'OPERATING_UNIT',
  '59100000-0000-0000-0000-000000000011',
  'GOVERNANCE_PARENT',
  'LEGAL_ENTITY',
  '59100000-0000-0000-0000-000000000021',
  'registry-smoke',
  'SYSTEM'
);

SELECT platform.create_governed_entity_relationship(
  '59100000-0000-0000-0000-000000000001',
  'OPERATING_UNIT',
  '59100000-0000-0000-0000-000000000011',
  'TERRITORIAL_JURISDICTION',
  'LOCATION',
  '59100000-0000-0000-0000-000000000031',
  'registry-smoke',
  'SYSTEM'
);

DO $$
DECLARE
  anchored_count integer;
  operating_nodes integer;
  legal_nodes integer;
  location_nodes integer;
BEGIN
  SELECT count(*)
    INTO anchored_count
    FROM platform.entity_relationships
   WHERE tenant_id = '59100000-0000-0000-0000-000000000001'
     AND relationship_key IN ('GOVERNANCE_PARENT','TERRITORIAL_JURISDICTION')
     AND definition_id IS NOT NULL
     AND source_registry_node_id IS NOT NULL
     AND target_registry_node_id IS NOT NULL;

  SELECT count(*) INTO operating_nodes
    FROM platform.entity_registry_nodes
   WHERE tenant_id = '59100000-0000-0000-0000-000000000001'
     AND node_type = 'OPERATING_UNIT'
     AND entity_key = '59100000-0000-0000-0000-000000000011'
     AND status = 'ACTIVE'
     AND valid_until IS NULL;

  SELECT count(*) INTO legal_nodes
    FROM platform.entity_registry_nodes
   WHERE tenant_id = '59100000-0000-0000-0000-000000000001'
     AND node_type = 'LEGAL_ENTITY'
     AND entity_key = '59100000-0000-0000-0000-000000000021'
     AND status = 'ACTIVE'
     AND valid_until IS NULL;

  SELECT count(*) INTO location_nodes
    FROM platform.entity_registry_nodes
   WHERE tenant_id = '59100000-0000-0000-0000-000000000001'
     AND node_type = 'LOCATION'
     AND entity_key = '59100000-0000-0000-0000-000000000031'
     AND status = 'ACTIVE'
     AND valid_until IS NULL;

  IF anchored_count <> 2 THEN
    RAISE EXCEPTION 'expected two registry-anchored governed edges, got %',
      anchored_count;
  END IF;
  IF operating_nodes <> 1 OR legal_nodes <> 1 OR location_nodes <> 1 THEN
    RAISE EXCEPTION
      'canonical registry backfill/resolve failed: operating %, legal %, location %',
      operating_nodes, legal_nodes, location_nodes;
  END IF;
END;
$$;

DO $$
DECLARE
  before_count integer;
  after_count integer;
BEGIN
  SELECT count(*) INTO before_count
    FROM platform.entity_relationships
   WHERE tenant_id = '59100000-0000-0000-0000-000000000001';

  BEGIN
    PERFORM platform.create_governed_entity_relationship(
      '59100000-0000-0000-0000-000000000001',
      'OPERATING_UNIT',
      '59100000-0000-0000-0000-000000000011',
      'GOVERNANCE_PARENT',
      'LEGAL_ENTITY',
      '59100000-0000-0000-0000-000000000099',
      'registry-smoke',
      'SYSTEM'
    );
    RAISE EXCEPTION 'phantom relationship unexpectedly succeeded';
  EXCEPTION
    WHEN foreign_key_violation THEN
      IF SQLERRM <> 'ENTITY_REGISTRY_NODE_NOT_FOUND' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM platform.create_governed_entity_relationship(
      '59100000-0000-0000-0000-000000000001',
      'OPERATING_UNIT',
      '59100000-0000-0000-0000-000000000011',
      'GOVERNANCE_PARENT',
      'LEGAL_ENTITY',
      '59100000-0000-0000-0000-000000000022',
      'registry-smoke',
      'SYSTEM'
    );
    RAISE EXCEPTION 'cross-tenant relationship unexpectedly succeeded';
  EXCEPTION
    WHEN foreign_key_violation THEN
      IF SQLERRM <> 'ENTITY_REGISTRY_NODE_NOT_FOUND' THEN
        RAISE;
      END IF;
  END;

  SELECT count(*) INTO after_count
    FROM platform.entity_relationships
   WHERE tenant_id = '59100000-0000-0000-0000-000000000001';

  IF after_count <> before_count THEN
    RAISE EXCEPTION
      'failed endpoint validation still persisted an edge: before %, after %',
      before_count, after_count;
  END IF;
END;
$$;
