BEGIN;

-- Gate 3 — SMS & WhatsApp OTP templates for PUBLIC-rail mobile verification.
-- Mirrors the email template seeded in 0136; the SMS channel carries only the
-- code (no HTML, no greeting, short body for carrier compatibility).

INSERT INTO platform.communication_templates (
  scope, tenant_id, organization_id, trigger_key, channel, locale, content_format,
  subject, title, body, required_variables, default_variables, status
)
SELECT
  'PLATFORM', NULL, NULL, 'lead-capture.otp.sms', 'sms', 'en', 'TEXT',
  'Verification Code',
  'Verification Code',
  'Your verification code is {{code}}. It expires in {{ttlMinutes}} minutes. Do not share it.',
  '["code","ttlMinutes"]'::jsonb,
  '{}'::jsonb,
  'ACTIVE'
WHERE NOT EXISTS (
  SELECT 1 FROM platform.communication_templates
   WHERE scope = 'PLATFORM'
     AND trigger_key = 'lead-capture.otp.sms'
     AND channel = 'sms'
     AND locale = 'en'
);

INSERT INTO platform.communication_templates (
  scope, tenant_id, organization_id, trigger_key, channel, locale, content_format,
  subject, title, body, required_variables, default_variables, status
)
SELECT
  'PLATFORM', NULL, NULL, 'lead-capture.otp.whatsapp', 'whatsapp', 'en', 'TEXT',
  'Verification Code',
  'Verification Code',
  'Your verification code is {{code}}. It expires in {{ttlMinutes}} minutes. Do not share it.',
  '["code","ttlMinutes"]'::jsonb,
  '{}'::jsonb,
  'ACTIVE'
WHERE NOT EXISTS (
  SELECT 1 FROM platform.communication_templates
   WHERE scope = 'PLATFORM'
     AND trigger_key = 'lead-capture.otp.whatsapp'
     AND channel = 'whatsapp'
     AND locale = 'en'
);

COMMIT;
