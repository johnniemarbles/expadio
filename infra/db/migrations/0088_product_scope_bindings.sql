BEGIN;

-- Product T/B/L directory. Codes are not minted here and are never storage keys.
-- Numbered 0088: 0083-0085 are unused, 0086 is social draft, 0087 is lead-capture provenance.
-- Does not alter platform.tenants / organizations / operating_units columns.
-- Empty table means mapping unavailable. Application still runs createScopeDirectory.

CREATE TABLE platform.product_scope_bindings (
  binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL CHECK (tenant_code ~ '^T-[0-9]{4,}$'),
  brand_code text NOT NULL CHECK (brand_code ~ '^B-[0-9]{4,}$'),
  location_code text NOT NULL CHECK (location_code = 'ALL' OR location_code ~ '^L-[0-9]{4,}$'),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  operating_unit_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_code, brand_code, location_code),
  UNIQUE (binding_id, tenant_id),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT product_scope_all_permitted_has_no_unit CHECK (
    (location_code = 'ALL' AND operating_unit_id IS NULL)
    OR (location_code <> 'ALL' AND operating_unit_id IS NOT NULL)
  )
);

ALTER TABLE platform.product_scope_bindings
  ADD CONSTRAINT product_scope_unit_same_org_fk
  FOREIGN KEY (operating_unit_id, tenant_id, organization_id)
  REFERENCES platform.operating_units(operating_unit_id, tenant_id, organization_id)
  ON DELETE CASCADE;

CREATE INDEX product_scope_bindings_tenant_idx
  ON platform.product_scope_bindings(tenant_id, brand_code, location_code);

CREATE OR REPLACE FUNCTION platform.product_scope_binding_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM platform.product_scope_bindings existing
    WHERE existing.tenant_code = NEW.tenant_code
      AND existing.tenant_id <> NEW.tenant_id
      AND existing.binding_id IS DISTINCT FROM NEW.binding_id
  ) THEN
    RAISE EXCEPTION 'TENANT_CODE_CONFLICT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM platform.product_scope_bindings existing
    WHERE existing.brand_code = NEW.brand_code
      AND (existing.tenant_id <> NEW.tenant_id OR existing.organization_id <> NEW.organization_id)
      AND existing.binding_id IS DISTINCT FROM NEW.binding_id
  ) THEN
    RAISE EXCEPTION 'BRAND_OWNERSHIP_CONFLICT';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER product_scope_binding_ownership_trg
  BEFORE INSERT OR UPDATE ON platform.product_scope_bindings
  FOR EACH ROW
  EXECUTE FUNCTION platform.product_scope_binding_ownership();

COMMENT ON TABLE platform.product_scope_bindings IS
  'Verified T/B/L to tenant/organization/operating-unit mapping. Does not allocate codes or grant Brand access.';

ALTER TABLE platform.product_scope_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.product_scope_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY product_scope_bindings_tenant_isolation ON platform.product_scope_bindings
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
