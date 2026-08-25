BEGIN;

CREATE TABLE platform.communication_templates (
  template_id uuid NOT NULL DEFAULT gen_random_uuid(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  scope text NOT NULL CHECK (scope IN ('PLATFORM','TENANT','ORGANIZATION')),
  tenant_id uuid REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  organization_id uuid,
  trigger_key text NOT NULL CHECK (btrim(trigger_key) <> ''),
  channel text NOT NULL CHECK (channel IN ('email','sms','whatsapp','voice','in_app','push','rcs')),
  locale text NOT NULL DEFAULT 'en' CHECK (btrim(locale) <> ''),
  content_format text NOT NULL CHECK (content_format IN ('TEXT','HTML','MARKDOWN')),
  subject text,
  title text,
  body text NOT NULL CHECK (btrim(body) <> ''),
  required_variables jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(required_variables) = 'array'),
  default_variables jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(default_variables) = 'object'),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, version),
  FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organizations(organization_id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT communication_template_scope_shape CHECK (
    (scope = 'PLATFORM' AND tenant_id IS NULL AND organization_id IS NULL)
    OR
    (scope = 'TENANT' AND tenant_id IS NOT NULL AND organization_id IS NULL)
    OR
    (scope = 'ORGANIZATION' AND tenant_id IS NOT NULL AND organization_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX communication_templates_active_platform_uq
  ON platform.communication_templates (trigger_key, channel, lower(locale))
  WHERE scope = 'PLATFORM' AND status = 'ACTIVE';

CREATE UNIQUE INDEX communication_templates_active_tenant_uq
  ON platform.communication_templates (tenant_id, trigger_key, channel, lower(locale))
  WHERE scope = 'TENANT' AND status = 'ACTIVE';

CREATE UNIQUE INDEX communication_templates_active_organization_uq
  ON platform.communication_templates (
    tenant_id, organization_id, trigger_key, channel, lower(locale)
  )
  WHERE scope = 'ORGANIZATION' AND status = 'ACTIVE';

CREATE INDEX communication_templates_resolution_idx
  ON platform.communication_templates (
    trigger_key,
    channel,
    lower(locale),
    scope,
    tenant_id,
    organization_id,
    status,
    version DESC
  );

ALTER TABLE platform.communication_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.communication_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY communication_templates_select
  ON platform.communication_templates
  FOR SELECT
  USING (
    scope = 'PLATFORM'
    OR tenant_id = platform.current_tenant_id()
  );

CREATE POLICY communication_templates_insert
  ON platform.communication_templates
  FOR INSERT
  WITH CHECK (
    scope <> 'PLATFORM'
    AND tenant_id = platform.current_tenant_id()
  );

CREATE POLICY communication_templates_update
  ON platform.communication_templates
  FOR UPDATE
  USING (
    scope <> 'PLATFORM'
    AND tenant_id = platform.current_tenant_id()
  )
  WITH CHECK (
    scope <> 'PLATFORM'
    AND tenant_id = platform.current_tenant_id()
  );

CREATE POLICY communication_templates_delete
  ON platform.communication_templates
  FOR DELETE
  USING (
    scope <> 'PLATFORM'
    AND tenant_id = platform.current_tenant_id()
  );

COMMIT;
