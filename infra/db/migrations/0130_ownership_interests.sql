BEGIN;

-- Kept distinct from the established enterprise-control-plane ownership table:
-- this table models percentage participation between entity graph nodes.
CREATE TABLE platform.entity_node_ownership_interests (
  interest_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  owned_node_id uuid NOT NULL REFERENCES platform.entity_nodes(node_id) ON DELETE RESTRICT,
  owning_node_id uuid NOT NULL REFERENCES platform.entity_nodes(node_id) ON DELETE RESTRICT,
  percentage numeric(7,4) NOT NULL CHECK (percentage > 0 AND percentage <= 100),
  share_class text,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  distribution_node_id uuid REFERENCES platform.entity_nodes(node_id) ON DELETE RESTRICT,
  partner_ref text,
  evidence_ref text,
  agreement_date date,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','TRANSFERRED','LAPSED','DISPUTED')),
  created_by text NOT NULL CHECK (btrim(created_by) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (owned_node_id <> owning_node_id),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX entity_node_ownership_owned_idx
  ON platform.entity_node_ownership_interests(tenant_id,owned_node_id,status);
ALTER TABLE platform.entity_node_ownership_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.entity_node_ownership_interests FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_node_ownership_tenant_isolation ON platform.entity_node_ownership_interests
  FOR ALL USING (tenant_id=platform.current_tenant_id())
  WITH CHECK (tenant_id=platform.current_tenant_id());

CREATE OR REPLACE FUNCTION platform.enforce_entity_node_ownership()
RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,platform
AS $$
DECLARE v_total numeric;
BEGIN
  IF EXISTS (
    SELECT 1 FROM platform.entity_node_ownership_interests i
     WHERE i.tenant_id=NEW.tenant_id AND i.owned_node_id=NEW.owned_node_id
       AND i.owning_node_id=NEW.owning_node_id AND i.interest_id<>NEW.interest_id
       AND daterange(i.effective_from,COALESCE(i.effective_to,'infinity'::date),'[)')
           && daterange(NEW.effective_from,COALESCE(NEW.effective_to,'infinity'::date),'[)')
  ) THEN
    RAISE EXCEPTION 'OWNERSHIP_PERIOD_OVERLAP' USING ERRCODE='23P01';
  END IF;
  SELECT COALESCE(sum(i.percentage),0)+NEW.percentage INTO v_total
    FROM platform.entity_node_ownership_interests i
   WHERE i.tenant_id=NEW.tenant_id AND i.owned_node_id=NEW.owned_node_id
     AND i.interest_id<>NEW.interest_id AND i.status='ACTIVE'
     AND daterange(i.effective_from,COALESCE(i.effective_to,'infinity'::date),'[)')
         && daterange(NEW.effective_from,COALESCE(NEW.effective_to,'infinity'::date),'[)');
  IF NEW.status='ACTIVE' AND v_total>100 THEN
    RAISE EXCEPTION 'OWNERSHIP_OVERAGE: projected total %',v_total USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entity_node_ownership_enforcement
BEFORE INSERT OR UPDATE ON platform.entity_node_ownership_interests
FOR EACH ROW EXECUTE FUNCTION platform.enforce_entity_node_ownership();

COMMIT;
