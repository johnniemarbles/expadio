\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('10480000-0000-0000-0000-000000001048', 'Directory Tenant 1048'),
  ('10490000-0000-0000-0000-000000001049', 'Directory Tenant 1049');

INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES
  ('20480000-0000-0000-0000-000000001048', '10480000-0000-0000-0000-000000001048', 'Brand Org 0001'),
  ('20490000-0000-0000-0000-000000001049', '10490000-0000-0000-0000-000000001049', 'Brand Org 0002');

INSERT INTO platform.operating_units (operating_unit_id, tenant_id, organization_id, name) VALUES
  ('30480000-0000-0000-0000-000000000009', '10480000-0000-0000-0000-000000001048', '20480000-0000-0000-0000-000000001048', 'Location 0009'),
  ('30490000-0000-0000-0000-000000000010', '10490000-0000-0000-0000-000000001049', '20490000-0000-0000-0000-000000001049', 'Location 0010');

INSERT INTO platform.product_scope_bindings (
  tenant_code, brand_code, location_code, tenant_id, organization_id, operating_unit_id
) VALUES
  ('T-1048', 'B-0001', 'L-0009', '10480000-0000-0000-0000-000000001048', '20480000-0000-0000-0000-000000001048', '30480000-0000-0000-0000-000000000009'),
  ('T-1048', 'B-0001', 'ALL', '10480000-0000-0000-0000-000000001048', '20480000-0000-0000-0000-000000001048', NULL),
  ('T-1049', 'B-0002', 'L-0010', '10490000-0000-0000-0000-000000001049', '20490000-0000-0000-0000-000000001049', '30490000-0000-0000-0000-000000000010');

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.product_scope_bindings (
      tenant_code, brand_code, location_code, tenant_id, organization_id, operating_unit_id
    ) VALUES (
      'T-1048', 'B-0099', 'ALL',
      '10490000-0000-0000-0000-000000001049',
      '20490000-0000-0000-0000-000000001049',
      NULL
    );
    RAISE EXCEPTION 'expected TENANT_CODE_CONFLICT';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'TENANT_CODE_CONFLICT' THEN RAISE;
      END IF;
  END;

  BEGIN
    INSERT INTO platform.product_scope_bindings (
      tenant_code, brand_code, location_code, tenant_id, organization_id, operating_unit_id
    ) VALUES (
      'T-1048', 'B-0001', 'L-0099',
      '10480000-0000-0000-0000-000000001048',
      '20480000-0000-0000-0000-000000001048',
      NULL
    );
    RAISE EXCEPTION 'expected all-permitted unit check to fail';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END;
$$;

GRANT SELECT ON platform.product_scope_bindings TO expadio_app;

SET ROLE expadio_app;
SELECT set_config('app.tenant_id', '10480000-0000-0000-0000-000000001048', false);

DO $$
DECLARE
  visible integer;
  sibling integer;
BEGIN
  SELECT count(*) INTO visible FROM platform.product_scope_bindings;
  IF visible <> 2 THEN RAISE EXCEPTION 'expected 2 visible bindings for T-1048, got %', visible; END IF;

  SELECT count(*) INTO sibling FROM platform.product_scope_bindings WHERE tenant_code = 'T-1049';
  IF sibling <> 0 THEN RAISE EXCEPTION 'tenant A saw tenant B product codes'; END IF;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'platform'
      AND c.relname = 'product_scope_bindings'
      AND c.relrowsecurity = true
      AND c.relforcerowsecurity = true
  ) THEN
    RAISE EXCEPTION 'product_scope_bindings RLS is not forced';
  END IF;
END;
$$;

SELECT 'product scope bindings smoke: ok' AS result;
