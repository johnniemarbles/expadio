BEGIN;

-- Resolves one verified T/B/L row without requiring app.tenant_id first.
-- product_scope_bindings is RLS-bound to current_tenant_id(); Brand requests
-- only know product codes until this lookup returns storage keys.
-- Does not mint codes, grant membership, or return customer records.

CREATE OR REPLACE FUNCTION platform.lookup_product_scope_binding(
  p_tenant_code text,
  p_brand_code text,
  p_location_code text
)
RETURNS TABLE (
  tenant_code text,
  brand_code text,
  location_code text,
  tenant_id uuid,
  organization_id uuid,
  operating_unit_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = platform, pg_temp
AS $$
  SELECT
    b.tenant_code,
    b.brand_code,
    b.location_code,
    b.tenant_id,
    b.organization_id,
    b.operating_unit_id
  FROM platform.product_scope_bindings b
  WHERE b.status = 'ACTIVE'
    AND b.tenant_code = p_tenant_code
    AND b.brand_code = p_brand_code
    AND b.location_code = p_location_code
$$;

REVOKE ALL ON FUNCTION platform.lookup_product_scope_binding(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.lookup_product_scope_binding(text, text, text) TO PUBLIC;

COMMENT ON FUNCTION platform.lookup_product_scope_binding(text, text, text) IS
  'Returns one ACTIVE T/B/L binding. Not membership, not CRM, not a code allocator.';

COMMIT;
