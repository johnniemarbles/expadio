BEGIN;

-- 0023 intentionally allowed ordinary governed configuration writes only at
-- tenant-contained levels. Platform Appearance now needs a separate, explicit
-- control-plane path for complete Platform/Plan/Vertical theme profile
-- publication. Keep Brand/Tenant writes tenant-scoped and require the
-- transaction-local app.platform_admin flag for global profile inserts.
DROP POLICY IF EXISTS configuration_setting_values_insert
  ON platform.configuration_setting_values;

CREATE POLICY configuration_setting_values_insert
  ON platform.configuration_setting_values
  FOR INSERT
  WITH CHECK (
    (
      tenant_id = platform.current_tenant_id()
      AND level IN ('TENANT', 'BRAND', 'WORKSPACE', 'USER_PREFERENCE', 'OPERATIONAL')
    )
    OR (
      current_setting('app.platform_admin', true) = 'true'
      AND tenant_id IS NULL
      AND level IN ('PLATFORM', 'PLAN', 'VERTICAL')
    )
  );

COMMIT;
