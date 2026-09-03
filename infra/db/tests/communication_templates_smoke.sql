\set ON_ERROR_STOP on

INSERT INTO platform.tenants (tenant_id, name) VALUES
  ('56565656-5656-5656-5656-565656565656', 'Template Tenant A'),
  ('78787878-7878-7878-7878-787878787878', 'Template Tenant B');

INSERT INTO platform.organizations (organization_id, tenant_id, name) VALUES
  ('56560000-0000-0000-0000-000000000001', '56565656-5656-5656-5656-565656565656', 'Template Org A'),
  ('78780000-0000-0000-0000-000000000001', '78787878-7878-7878-7878-787878787878', 'Template Org B');

INSERT INTO platform.communication_templates (
  template_id, scope, tenant_id, organization_id, trigger_key, channel,
  locale, content_format, subject, body, required_variables,
  default_variables, status
) VALUES
  (
    '90900000-0000-0000-0000-000000000001',
    'PLATFORM', NULL, NULL, 'lead.welcome', 'email', 'en', 'HTML',
    'Welcome {{name}}', '<p>Hello {{name}}</p>', '["name"]'::jsonb,
    '{}'::jsonb, 'ACTIVE'
  ),
  (
    '90900000-0000-0000-0000-000000000002',
    'TENANT', '56565656-5656-5656-5656-565656565656', NULL,
    'lead.welcome', 'email', 'en', 'HTML', 'Tenant welcome {{name}}',
    '<p>Tenant hello {{name}}</p>', '["name"]'::jsonb, '{}'::jsonb, 'ACTIVE'
  ),
  (
    '90900000-0000-0000-0000-000000000003',
    'ORGANIZATION', '56565656-5656-5656-5656-565656565656',
    '56560000-0000-0000-0000-000000000001', 'lead.welcome', 'email',
    'en', 'HTML', 'Org welcome {{name}}', '<p>Org hello {{name}}</p>',
    '["name"]'::jsonb, '{}'::jsonb, 'ACTIVE'
  ),
  (
    '90900000-0000-0000-0000-000000000004',
    'TENANT', '78787878-7878-7878-7878-787878787878', NULL,
    'lead.welcome', 'email', 'en', 'TEXT', NULL, 'Other tenant hello',
    '[]'::jsonb, '{}'::jsonb, 'ACTIVE'
  );

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_templates (
      scope, tenant_id, trigger_key, channel, locale, content_format, body
    ) VALUES (
      'PLATFORM',
      '56565656-5656-5656-5656-565656565656',
      'invalid.scope', 'email', 'en', 'TEXT', 'invalid'
    );
    RAISE EXCEPTION 'invalid platform template scope unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_templates (
      scope, tenant_id, trigger_key, channel, locale, content_format, body, status
    ) VALUES (
      'TENANT',
      '56565656-5656-5656-5656-565656565656',
      'lead.welcome', 'email', 'EN', 'TEXT', 'duplicate active', 'ACTIVE'
    );
    RAISE EXCEPTION 'duplicate active tenant template unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_templates (
      scope, tenant_id, organization_id, trigger_key, channel, locale,
      content_format, body
    ) VALUES (
      'ORGANIZATION',
      '56565656-5656-5656-5656-565656565656',
      '78780000-0000-0000-0000-000000000001',
      'cross.tenant', 'sms', 'en', 'TEXT', 'invalid'
    );
    RAISE EXCEPTION 'cross-tenant template organization unexpectedly succeeded';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;
END;
$$;

DROP ROLE IF EXISTS expadio_template_test;
CREATE ROLE expadio_template_test NOLOGIN;
GRANT USAGE ON SCHEMA platform TO expadio_template_test;
GRANT SELECT, INSERT ON platform.communication_templates TO expadio_template_test;

SET ROLE expadio_template_test;
SELECT set_config('app.tenant_id', '56565656-5656-5656-5656-565656565656', false);

DO $$
DECLARE
  visible_count integer;
  platform_count integer;
  tenant_count integer;
  organization_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM platform.communication_templates;
  SELECT count(*) INTO platform_count
    FROM platform.communication_templates WHERE scope = 'PLATFORM';
  SELECT count(*) INTO tenant_count
    FROM platform.communication_templates WHERE scope = 'TENANT';
  SELECT count(*) INTO organization_count
    FROM platform.communication_templates WHERE scope = 'ORGANIZATION';

  IF visible_count <> platform_count + tenant_count + organization_count THEN
    RAISE EXCEPTION 'tenant A template visibility total was inconsistent: %', visible_count;
  END IF;
  IF platform_count < 1 OR tenant_count <> 1 OR organization_count <> 1 THEN
    RAISE EXCEPTION 'tenant A template scope visibility was incorrect';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_templates (
      scope, trigger_key, channel, locale, content_format, body
    ) VALUES ('PLATFORM', 'forbidden.platform', 'email', 'en', 'TEXT', 'blocked');
    RAISE EXCEPTION 'tenant platform-template write unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO platform.communication_templates (
      scope, tenant_id, trigger_key, channel, locale, content_format, body
    ) VALUES (
      'TENANT',
      '78787878-7878-7878-7878-787878787878',
      'forbidden.tenant', 'email', 'en', 'TEXT', 'blocked'
    );
    RAISE EXCEPTION 'cross-tenant template RLS write unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;

SELECT 'communication templates smoke: ok' AS result;
