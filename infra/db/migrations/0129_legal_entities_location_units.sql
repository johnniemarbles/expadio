-- ============================================================================
-- 0122_legal_entities_location_units.sql
-- Entity Graph Phase 3 — legal and physical overlays.
--
-- A legal entity overlays an entity node with incorporation metadata.
-- A location unit overlays an entity node with physical site metadata.
--
-- These are overlays, not subtypes: a node may have a legal entity overlay,
-- a location unit overlay, both, or neither. They are 1:1 with their node
-- (one node, at most one active legal entity record; at most one location unit).
--
-- Why separate tables rather than columns on entity_nodes?
--   Legal metadata changes infrequently and has its own governance process.
--   Physical metadata is queried independently (geo-search, proximity).
--   The separation keeps entity_nodes lean and the specialized records auditable.
-- ============================================================================

BEGIN;

-- ── Legal Entities ──────────────────────────────────────────────────────────

CREATE TABLE platform.legal_entities (
  legal_entity_id     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  node_id             uuid        NOT NULL REFERENCES platform.entity_nodes(node_id) ON DELETE CASCADE,

  -- Legal registration
  registered_name     text        NOT NULL CHECK (btrim(registered_name) <> ''),
  trading_name        text,
  registration_number text,
  registration_jurisdiction text, -- ISO 3166-1 alpha-2 or subdivision code
  legal_form          text        CHECK (legal_form IN (
    'LLC', 'LTD', 'CORP', 'PTE_LTD', 'GMBH', 'SAS', 'SA',
    'PARTNERSHIP', 'SOLE_TRADER', 'FRANCHISE_AGREEMENT', 'COOPERATIVE', 'OTHER'
  )),
  incorporated_at     date,

  -- Tax and regulatory
  tax_identifier      text,       -- VAT, EIN, GST, etc.
  tax_jurisdiction    text,       -- ISO code of primary tax jurisdiction

  -- Registered address (structured, not JSONB — queried and indexed)
  address_line_1      text,
  address_line_2      text,
  city                text,
  state_province      text,
  postal_code         text,
  country_code        char(2),    -- ISO 3166-1 alpha-2

  status              text        NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE', 'DORMANT', 'STRUCK_OFF', 'LIQUIDATED')),

  struck_off_at       date,
  evidence_ref        text,       -- Document/filing reference
  notes               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by          uuid        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- One active legal entity per node.
CREATE UNIQUE INDEX legal_entities_active_node_idx
  ON platform.legal_entities (node_id)
  WHERE status = 'ACTIVE';

CREATE INDEX legal_entities_tenant_idx
  ON platform.legal_entities (tenant_id, status);

CREATE INDEX legal_entities_registration_idx
  ON platform.legal_entities (registration_jurisdiction, registration_number)
  WHERE registration_number IS NOT NULL;

ALTER TABLE platform.legal_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.legal_entities FORCE ROW LEVEL SECURITY;

CREATE POLICY legal_entities_select
  ON platform.legal_entities
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY legal_entities_insert
  ON platform.legal_entities
  FOR INSERT WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY legal_entities_update
  ON platform.legal_entities
  FOR UPDATE USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY legal_entities_no_delete
  ON platform.legal_entities
  FOR DELETE USING (false);

-- updated_at maintenance
CREATE OR REPLACE FUNCTION platform.touch_legal_entity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER legal_entities_touch
BEFORE UPDATE ON platform.legal_entities
FOR EACH ROW EXECUTE FUNCTION platform.touch_legal_entity();

-- ── Location Units ──────────────────────────────────────────────────────────

CREATE TABLE platform.location_units (
  location_id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  node_id           uuid        NOT NULL REFERENCES platform.entity_nodes(node_id) ON DELETE CASCADE,

  -- Structured address
  address_line_1    text        NOT NULL CHECK (btrim(address_line_1) <> ''),
  address_line_2    text,
  city              text        NOT NULL CHECK (btrim(city) <> ''),
  state_province    text,
  postal_code       text,
  country_code      char(2)     NOT NULL, -- ISO 3166-1 alpha-2

  -- Geography (PostGIS-ready but stored as plain numeric for now)
  latitude          numeric(10, 7),
  longitude         numeric(10, 7),
  timezone          text,       -- IANA timezone identifier, e.g. 'America/New_York'

  -- Operational metadata
  operating_hours   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  phone             text,
  email             text,

  -- §2 — a location passes through distinct operational states
  operational_status text       NOT NULL DEFAULT 'PLANNED'
                     CHECK (operational_status IN (
                       'PLANNED',            -- site identified, not yet open
                       'FIT_OUT',            -- under construction / fitting out
                       'OPEN',               -- trading normally
                       'TEMPORARILY_CLOSED', -- short-term closure (renovation, flood)
                       'PERMANENTLY_CLOSED'  -- terminal; no reopen expected
                     )),

  opened_at         date,
  closed_at         date,

  notes             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by        uuid        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CHECK (
    latitude  IS NULL OR (latitude  BETWEEN -90  AND 90),
    longitude IS NULL OR (longitude BETWEEN -180 AND 180)
  ),
  CHECK (
    (operational_status = 'PERMANENTLY_CLOSED' AND closed_at IS NOT NULL)
    OR operational_status <> 'PERMANENTLY_CLOSED'
  )
);

-- One location unit per node.
CREATE UNIQUE INDEX location_units_node_idx
  ON platform.location_units (node_id);

CREATE INDEX location_units_tenant_country_idx
  ON platform.location_units (tenant_id, country_code, operational_status);

-- Geo bounding-box search (without PostGIS).
CREATE INDEX location_units_geo_idx
  ON platform.location_units (tenant_id, latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

ALTER TABLE platform.location_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.location_units FORCE ROW LEVEL SECURITY;

CREATE POLICY location_units_select
  ON platform.location_units
  FOR SELECT USING (tenant_id = platform.current_tenant_id());

CREATE POLICY location_units_insert
  ON platform.location_units
  FOR INSERT WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY location_units_update
  ON platform.location_units
  FOR UPDATE USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY location_units_no_delete
  ON platform.location_units
  FOR DELETE USING (false);

CREATE OR REPLACE FUNCTION platform.touch_location_unit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER location_units_touch
BEFORE UPDATE ON platform.location_units
FOR EACH ROW EXECUTE FUNCTION platform.touch_location_unit();

COMMIT;
