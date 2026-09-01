BEGIN;

-- Platform Appearance Manager publishes a new immutable PLATFORM theme profile.
-- Existing governed-configuration RLS intentionally allowed only tenant-scoped
-- writes. Preserve that rule and add one narrowly-scoped control-plane path:
-- a transaction may append a PLATFORM theme profile only after trusted server
-- code has asserted Platform administration and set app.platform_admin=true.

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
      setting_key = 'appearance.theme.profile'
      AND level = 'PLATFORM'
      AND scope_id IS NULL
      AND tenant_id IS NULL
      AND COALESCE(current_setting('app.platform_admin', true), '') = 'true'
    )
  );

COMMIT;
