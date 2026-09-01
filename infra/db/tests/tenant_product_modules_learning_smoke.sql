\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name, vertical_key) VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'DENTEX Demo', 'dentex'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'WeRealtors Demo', 'werealtors');

INSERT INTO platform.tenant_module_entitlements (
  tenant_id, module_key, source_type, source_key, status
) VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'learning', 'PLAN', 'professional', 'ACTIVE'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'learning', 'PLAN', 'starter', 'REVOKED');

INSERT INTO platform.tenant_modules (
  tenant_id, module_key, status, activation_requested_by_subject_id,
  activated_by_subject_id, activated_at
) VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'learning', 'ACTIVE', 'smoke-admin-a', 'smoke-admin-a', now()),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'learning', 'SUSPENDED', 'smoke-admin-b', 'smoke-admin-b', now());

INSERT INTO platform.learning_tenant_settings (
  tenant_id, tenant_module_id, academy_name, industry_pack_key, starter_pack_status
)
SELECT tenant_id, tenant_module_id, 'DENTEX Demo Academy', 'dentex', 'AVAILABLE'
  FROM platform.tenant_modules
 WHERE tenant_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

INSERT INTO platform.learning_academies (
  tenant_id, tenant_module_id, name, slug, is_default, source_vertical_key
)
SELECT tenant_id, tenant_module_id, 'DENTEX Demo Academy', 'academy', true, 'dentex'
  FROM platform.tenant_modules
 WHERE tenant_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM platform.product_modules
     WHERE module_key = 'learning'
       AND enabled = true
       AND manifest->>'provisioner' = 'learning.v1'
  ) THEN
    RAISE EXCEPTION 'learning module manifest missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform'
       AND c.relname = 'learning_academies'
       AND c.relrowsecurity = true
       AND c.relforcerowsecurity = true
  ) THEN
    RAISE EXCEPTION 'learning_academies FORCE RLS missing';
  END IF;
END;
$$;

DROP ROLE IF EXISTS expadio_learning_smoke;
CREATE ROLE expadio_learning_smoke NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_learning_smoke;
GRANT SELECT ON
  platform.product_modules,
  platform.tenant_module_entitlements,
  platform.tenant_modules,
  platform.learning_tenant_settings,
  platform.learning_academies
TO expadio_learning_smoke;

SET ROLE expadio_learning_smoke;
SELECT set_config('app.tenant_id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', false);

DO $$
DECLARE
  entitlement_count integer;
  installation_count integer;
  academy_count integer;
BEGIN
  SELECT count(*) INTO entitlement_count FROM platform.tenant_module_entitlements;
  IF entitlement_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one visible entitlement, got %', entitlement_count;
  END IF;

  SELECT count(*) INTO installation_count FROM platform.tenant_modules;
  IF installation_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one visible module installation, got %', installation_count;
  END IF;

  SELECT count(*) INTO academy_count FROM platform.learning_academies;
  IF academy_count <> 1 THEN
    RAISE EXCEPTION 'tenant A expected one visible academy, got %', academy_count;
  END IF;
END;
$$;

RESET ROLE;

SELECT 'tenant product modules learning smoke: ok' AS result;
