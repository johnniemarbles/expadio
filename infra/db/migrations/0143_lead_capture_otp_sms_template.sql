BEGIN;

-- Gate 3 — SMS OTP template for PUBLIC-rail mobile verification.
-- Mirrors the email template seeded in 0136; the SMS channel carries only the
-- code (no HTML, no greeting, short body for carrier compatibility).
-- The WhatsApp template is registered here too with the same variables; providers
-- that distinguish WhatsApp from plain SMS route on the trigger key suffix.
--
-- Both templates are idempotent: safe to re-run if the migration was partially
-- applied. They are PLATFORM-scope so the provider can be wired at the tenant
-- level without per-org configuration.

INSERT INTO platform.communication_templates
  (tenant_id, trigger_key, scope, format, body_template, variables_schema, created_at, updated_at)
SELECT
  o.tenant_id,
  'lead-capture.otp.sms',
  'PLATFORM',
  'PLAIN',
  'Your verification code is {{code}}. It expires in {{ttlMinutes}} minutes. Do not share it.',
  '{"code":{"type":"string","required":true},"ttlMinutes":{"type":"number","required":true}}'::jsonb,
  now(), now()
FROM (SELECT DISTINCT tenant_id FROM platform.organizations) o
WHERE NOT EXISTS (
  SELECT 1 FROM platform.communication_templates t2
  WHERE t2.tenant_id = o.tenant_id AND t2.trigger_key = 'lead-capture.otp.sms'
);

INSERT INTO platform.communication_templates
  (tenant_id, trigger_key, scope, format, body_template, variables_schema, created_at, updated_at)
SELECT
  o.tenant_id,
  'lead-capture.otp.whatsapp',
  'PLATFORM',
  'PLAIN',
  'Your verification code is {{code}}. It expires in {{ttlMinutes}} minutes. Do not share it.',
  '{"code":{"type":"string","required":true},"ttlMinutes":{"type":"number","required":true}}'::jsonb,
  now(), now()
FROM (SELECT DISTINCT tenant_id FROM platform.organizations) o
WHERE NOT EXISTS (
  SELECT 1 FROM platform.communication_templates t2
  WHERE t2.tenant_id = o.tenant_id AND t2.trigger_key = 'lead-capture.otp.whatsapp'
);

COMMIT;
