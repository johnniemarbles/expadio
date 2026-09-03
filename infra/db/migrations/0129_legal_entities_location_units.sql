BEGIN;

-- The enterprise control plane already owns platform.legal_entities. Attach its
-- records to graph nodes additively; do not replace that authoritative table.
ALTER TABLE platform.legal_entities
  ADD COLUMN IF NOT EXISTS node_id uuid REFERENCES platform.entity_nodes(node_id),
  ADD COLUMN IF NOT EXISTS trading_name text,
  ADD COLUMN IF NOT EXISTS incorporated_at date,
  ADD COLUMN IF NOT EXISTS tax_identifier text,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction text,
  ADD COLUMN IF NOT EXISTS evidence_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS legal_entities_active_node_uq
  ON platform.legal_entities (tenant_id, node_id)
  WHERE node_id IS NOT NULL AND status NOT IN ('REJECTED','INACTIVE');
CREATE INDEX IF NOT EXISTS legal_entities_node_idx
  ON platform.legal_entities (tenant_id, node_id);

CREATE TABLE platform.location_units (
  location_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES platform.entity_nodes(node_id) ON DELETE RESTRICT,
  address_line1 text NOT NULL CHECK (btrim(address_line1) <> ''),
  address_line2 text,
  city text NOT NULL CHECK (btrim(city) <> ''),
  state_province text,
  postal_code text,
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  latitude numeric(9,6) CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) CHECK (longitude BETWEEN -180 AND 180),
  timezone text,
  operating_hours jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(operating_hours)='object'),
  phone text,
  email text,
  operational_status text NOT NULL DEFAULT 'PLANNED'
    CHECK (operational_status IN ('PLANNED','FIT_OUT','OPEN','TEMPORARILY_CLOSED','PERMANENTLY_CLOSED')),
  opened_at date,
  closed_at date,
  created_by text NOT NULL CHECK (btrim(created_by) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,node_id),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE INDEX location_units_tenant_status_idx ON platform.location_units(tenant_id,operational_status);
ALTER TABLE platform.location_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.location_units FORCE ROW LEVEL SECURITY;
CREATE POLICY location_units_tenant_isolation ON platform.location_units
  FOR ALL USING (tenant_id=platform.current_tenant_id())
  WITH CHECK (tenant_id=platform.current_tenant_id());

CREATE OR REPLACE FUNCTION platform.enforce_location_node_type()
RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,platform
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM platform.entity_nodes n
     WHERE n.node_id=NEW.node_id AND n.tenant_id=NEW.tenant_id
       AND n.node_type IN ('UNIT','LOCATION')
  ) THEN
    RAISE EXCEPTION 'LOCATION_NODE_TYPE_INVALID' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER location_units_node_type_check
BEFORE INSERT OR UPDATE OF node_id,tenant_id ON platform.location_units
FOR EACH ROW EXECUTE FUNCTION platform.enforce_location_node_type();

COMMIT;
