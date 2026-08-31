BEGIN;

-- Shared tenant product modules.
--
-- This layer intentionally sits above the existing Capability Fabric. Product
-- modules are installable tenant experiences; capabilities remain governed
-- execution/provider primitives. A commercial control plane writes entitlement
-- rows. Tenant-facing activation may consume, but never mint, entitlements.

CREATE TABLE platform.product_modules (
  module_key text PRIMARY KEY CHECK (btrim(module_key) <> ''),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'SHARED_TENANT_MODULE'
    CHECK (category IN ('SHARED_TENANT_MODULE','INDUSTRY_MODULE','PLATFORM_MODULE')),
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(manifest) = 'object'),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.tenant_module_entitlements (
  entitlement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  module_key text NOT NULL REFERENCES platform.product_modules(module_key) ON DELETE RESTRICT,
  source_type text NOT NULL
    CHECK (source_type IN ('PLAN','ADD_ON','TRIAL','CONTRACT','PLATFORM_GRANT')),
  source_key text NOT NULL CHECK (btrim(source_key) <> ''),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','REVOKED','EXPIRED')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_module_entitlement_window
    CHECK (valid_until IS NULL OR valid_until > valid_from),
  UNIQUE (tenant_id, module_key, source_type, source_key)
);

CREATE INDEX tenant_module_entitlements_lookup_idx
  ON platform.tenant_module_entitlements (tenant_id, module_key, status, valid_from, valid_until);

CREATE TABLE platform.tenant_modules (
  tenant_module_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  module_key text NOT NULL REFERENCES platform.product_modules(module_key) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVATION_PENDING'
    CHECK (status IN (
      'ACTIVATION_PENDING',
      'PROVISIONING',
      'ACTIVE',
      'SUSPENDED',
      'DEACTIVATED',
      'PROVISIONING_FAILED'
    )),
  activation_requested_by_subject_id text NOT NULL CHECK (btrim(activation_requested_by_subject_id) <> ''),
  activated_by_subject_id text,
  activated_at timestamptz,
  deactivated_at timestamptz,
  suspension_reason_key text,
  provisioning_error_key text,
  configuration_version integer NOT NULL DEFAULT 1 CHECK (configuration_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, module_key),
  UNIQUE (tenant_module_id, tenant_id)
);

CREATE INDEX tenant_modules_tenant_status_idx
  ON platform.tenant_modules (tenant_id, status, module_key);

-- Learning owns its configuration. Generic module state answers whether the
-- module is available/active; this table answers how Learning is configured.
CREATE TABLE platform.learning_tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  tenant_module_id uuid NOT NULL UNIQUE,
  academy_name text NOT NULL CHECK (btrim(academy_name) <> ''),
  default_language text NOT NULL DEFAULT 'en' CHECK (btrim(default_language) <> ''),
  default_timezone text NOT NULL DEFAULT 'UTC' CHECK (btrim(default_timezone) <> ''),
  audience_types text[] NOT NULL DEFAULT ARRAY['EMPLOYEES']::text[],
  industry_pack_key text,
  starter_pack_status text NOT NULL DEFAULT 'NOT_INSTALLED'
    CHECK (starter_pack_status IN ('NOT_INSTALLED','AVAILABLE','INSTALLING','INSTALLED','FAILED')),
  ai_features_enabled boolean NOT NULL DEFAULT false,
  external_learners_enabled boolean NOT NULL DEFAULT false,
  commerce_enabled boolean NOT NULL DEFAULT false,
  community_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_module_id, tenant_id)
    REFERENCES platform.tenant_modules(tenant_module_id, tenant_id)
    ON DELETE CASCADE
);

CREATE TABLE platform.learning_academies (
  academy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  tenant_module_id uuid NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  is_default boolean NOT NULL DEFAULT false,
  source_vertical_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_module_id, tenant_id)
    REFERENCES platform.tenant_modules(tenant_module_id, tenant_id)
    ON DELETE CASCADE,
  UNIQUE (tenant_id, slug)
);

CREATE UNIQUE INDEX learning_academies_one_default_uq
  ON platform.learning_academies (tenant_id)
  WHERE is_default = true;

ALTER TABLE platform.tenant_module_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_module_entitlements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_module_entitlements_tenant_isolation
  ON platform.tenant_module_entitlements
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.tenant_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_modules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_modules_tenant_isolation
  ON platform.tenant_modules
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_tenant_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_tenant_settings_tenant_isolation
  ON platform.learning_tenant_settings
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE platform.learning_academies ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.learning_academies FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_academies_tenant_isolation
  ON platform.learning_academies
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

INSERT INTO platform.product_modules (
  module_key,
  display_name,
  description,
  category,
  manifest,
  enabled
) VALUES (
  'learning',
  'Learning',
  'Shared Learning, Skills, Certification and Compliance module for tenant brands.',
  'SHARED_TENANT_MODULE',
  '{
    "version": 1,
    "route": "/learning",
    "provisioner": "learning.v1",
    "requiredPlatformServices": ["identity", "audit"],
    "optionalIntegrations": ["communications", "ai", "knowledge", "billing"],
    "industryPackAware": true
  }'::jsonb,
  true
);

COMMIT;
