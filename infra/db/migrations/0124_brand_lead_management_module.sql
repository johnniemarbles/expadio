BEGIN;

-- Lead Management is a Brand-operated tenant product module. Catalogue metadata
-- contributes navigation only; commercial entitlement and tenant installation
-- remain separate authoritative controls.
INSERT INTO platform.product_modules (
  module_key,
  display_name,
  description,
  category,
  manifest,
  enabled
) VALUES (
  'lead-management',
  'Lead Management',
  'Capture, qualify and progress organization-scoped leads into customers.',
  'SHARED_TENANT_MODULE',
  jsonb_build_object(
    'route', '/leads',
    'shell',
    jsonb_build_object(
      'category', 'Growth',
      'iconKey', 'leads',
      'defaultPinned', true,
      'order', 80,
      'sections', jsonb_build_array(
        jsonb_build_object('id','overview','label','Leads','href','/leads','placement','primary')
      ),
      'quickActions', jsonb_build_array(
        jsonb_build_object('id','new-lead','label','Create lead','href','/leads#new-lead')
      )
    )
  ),
  true
)
ON CONFLICT (module_key) DO UPDATE
SET display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    manifest = EXCLUDED.manifest,
    enabled = EXCLUDED.enabled,
    updated_at = now();

-- Deliberately no INSERT into tenant_module_entitlements or tenant_modules.
-- Catalogue presence cannot grant commercial access or activate the module.

COMMIT;
