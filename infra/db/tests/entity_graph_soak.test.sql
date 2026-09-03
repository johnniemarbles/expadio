\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  tenant_a uuid := '64f7c7d2-a001-4e32-a201-000000000001';
  tenant_b uuid := '64f7c7d2-a001-4e32-a201-000000000002';
  hq uuid; state_a uuid; state_b uuid; operator uuid; unit_a uuid; unit_b uuid;
  owner_a uuid; owner_b uuid;
  missing_rls text;
BEGIN
  INSERT INTO platform.tenants(tenant_id,name) VALUES
    (tenant_a,'Entity Graph Soak A'),(tenant_b,'Entity Graph Soak B');

  PERFORM set_config('app.tenant_id',tenant_a::text,true);
  PERFORM set_config('app.subject_id','entity-soak',true);

  INSERT INTO platform.entity_nodes(tenant_id,node_type,display_name,created_by)
  VALUES (tenant_a,'BRAND_HQ','HQ','entity-soak') RETURNING node_id INTO hq;
  BEGIN
    INSERT INTO platform.entity_nodes(tenant_id,node_type,display_name,created_by)
    VALUES (tenant_a,'BRAND_HQ','Duplicate HQ','entity-soak');
    RAISE EXCEPTION 'FAIL Gate 2: duplicate BRAND_HQ accepted';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS Gate 2: BRAND_HQ uniqueness'; END;

  INSERT INTO platform.entity_nodes(tenant_id,node_type,display_name,created_by) VALUES
    (tenant_a,'STATE_MASTER','State A','entity-soak'),
    (tenant_a,'STATE_MASTER','State B','entity-soak'),
    (tenant_a,'MULTI_UNIT','Operator','entity-soak'),
    (tenant_a,'UNIT','Unit A','entity-soak'),
    (tenant_a,'UNIT','Unit B','entity-soak'),
    (tenant_a,'JV_PARTNER','Partner A','entity-soak'),
    (tenant_a,'JV_PARTNER','Partner B','entity-soak');
  SELECT node_id INTO state_a FROM platform.entity_nodes WHERE tenant_id=tenant_a AND display_name='State A';
  SELECT node_id INTO state_b FROM platform.entity_nodes WHERE tenant_id=tenant_a AND display_name='State B';
  SELECT node_id INTO operator FROM platform.entity_nodes WHERE tenant_id=tenant_a AND display_name='Operator';
  SELECT node_id INTO unit_a FROM platform.entity_nodes WHERE tenant_id=tenant_a AND display_name='Unit A';
  SELECT node_id INTO unit_b FROM platform.entity_nodes WHERE tenant_id=tenant_a AND display_name='Unit B';
  SELECT node_id INTO owner_a FROM platform.entity_nodes WHERE tenant_id=tenant_a AND display_name='Partner A';
  SELECT node_id INTO owner_b FROM platform.entity_nodes WHERE tenant_id=tenant_a AND display_name='Partner B';

  INSERT INTO platform.entity_relationships(
    tenant_id,source_entity_type,source_entity_id,relationship_key,target_entity_type,target_entity_id,
    status,created_by_subject_id,source_node_id,target_node_id,relationship_type)
  VALUES
    (tenant_a,'ENTITY_NODE',operator::text,'COMMERCIAL_PARENT','ENTITY_NODE',unit_a::text,'ACTIVE','entity-soak',operator,unit_a,'COMMERCIAL_PARENT'),
    (tenant_a,'ENTITY_NODE',operator::text,'COMMERCIAL_PARENT','ENTITY_NODE',unit_b::text,'ACTIVE','entity-soak',operator,unit_b,'COMMERCIAL_PARENT'),
    (tenant_a,'ENTITY_NODE',state_a::text,'TERRITORIAL_JURISDICTION','ENTITY_NODE',unit_a::text,'ACTIVE','entity-soak',state_a,unit_a,'TERRITORIAL_JURISDICTION'),
    (tenant_a,'ENTITY_NODE',state_b::text,'TERRITORIAL_JURISDICTION','ENTITY_NODE',unit_b::text,'ACTIVE','entity-soak',state_b,unit_b,'TERRITORIAL_JURISDICTION');
  RAISE NOTICE 'PASS Gates 3-5: independent commercial and territorial edges';

  IF NOT EXISTS(SELECT 1 FROM platform.commercial_closure(operator) WHERE node_id=unit_a)
     OR NOT EXISTS(SELECT 1 FROM platform.commercial_closure(operator) WHERE node_id=unit_b)
     OR EXISTS(SELECT 1 FROM platform.territorial_closure(state_a) WHERE node_id=unit_b)
     OR platform.node_is_reachable(state_a,unit_b,'TERRITORIAL') THEN
    RAISE EXCEPTION 'FAIL Gates 4-5: purpose closure isolation';
  END IF;
  RAISE NOTICE 'PASS Gates 4-5: purpose closure isolation';

  BEGIN
    INSERT INTO platform.entity_relationships(
      tenant_id,source_entity_type,source_entity_id,relationship_key,target_entity_type,target_entity_id,
      status,created_by_subject_id,source_node_id,target_node_id,relationship_type)
    VALUES(tenant_a,'ENTITY_NODE',hq::text,'COMMERCIAL_PARENT','ENTITY_NODE',unit_a::text,
           'ACTIVE','entity-soak',hq,unit_a,'COMMERCIAL_PARENT');
    RAISE EXCEPTION 'FAIL Gate 6: cardinality violation accepted';
  EXCEPTION
    WHEN check_violation THEN RAISE NOTICE 'PASS Gate 6: cardinality enforcement';
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'Cardinality violation:%' THEN
        RAISE NOTICE 'PASS Gate 6: cardinality enforcement';
      ELSE
        RAISE;
      END IF;
  END;

  INSERT INTO platform.entity_node_ownership_interests
    (tenant_id,owned_node_id,owning_node_id,percentage,created_by)
  VALUES(tenant_a,unit_a,owner_a,60,'entity-soak');
  BEGIN
    INSERT INTO platform.entity_node_ownership_interests
      (tenant_id,owned_node_id,owning_node_id,percentage,created_by)
    VALUES(tenant_a,unit_a,owner_b,50,'entity-soak');
    RAISE EXCEPTION 'FAIL Gate 7: ownership overage accepted';
  EXCEPTION
    WHEN check_violation THEN RAISE NOTICE 'PASS Gate 7: ownership overage rejected';
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'OWNERSHIP_OVERAGE:%' THEN
        RAISE NOTICE 'PASS Gate 7: ownership overage rejected';
      ELSE
        RAISE;
      END IF;
  END;
  INSERT INTO platform.entity_node_ownership_interests
    (tenant_id,owned_node_id,owning_node_id,percentage,created_by)
  VALUES(tenant_a,unit_a,owner_b,40,'entity-soak');

  SELECT string_agg(format('%I:%s', table_name, reason), ', ' ORDER BY table_name)
    INTO missing_rls
    FROM platform.tenant_scoped_tables_missing_rls();

  IF missing_rls IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL Gate 11: tenant table missing RLS: %', missing_rls;
  END IF;
  RAISE NOTICE 'PASS Gate 11: RLS drift check';

  -- Compatibility smoke: retained organization_closure remains queryable.
  PERFORM 1 FROM platform.organization_closure LIMIT 1;
  RAISE NOTICE 'PASS Gate 10: organization_closure compatibility';
END $$;

DROP ROLE IF EXISTS expadio_entity_graph_soak;
CREATE ROLE expadio_entity_graph_soak;
GRANT USAGE ON SCHEMA platform TO expadio_entity_graph_soak;
GRANT SELECT ON platform.entity_nodes TO expadio_entity_graph_soak;

SET ROLE expadio_entity_graph_soak;
SELECT set_config('app.tenant_id','64f7c7d2-a001-4e32-a201-000000000002',true);
DO $$
DECLARE
  visible_count int;
BEGIN
  SELECT count(*) INTO visible_count
    FROM platform.entity_nodes
   WHERE tenant_id='64f7c7d2-a001-4e32-a201-000000000001'::uuid;
  IF visible_count<>0 THEN RAISE EXCEPTION 'FAIL Gate 1: cross-tenant row visible'; END IF;
  RAISE NOTICE 'PASS Gate 1: cross-tenant RLS isolation';
END $$;
RESET ROLE;

ROLLBACK;
