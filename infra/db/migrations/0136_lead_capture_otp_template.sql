BEGIN;

-- Platform-scope OTP email template for the PUBLIC (Rail B) capture gate.
--
-- Trigger `lead-capture.otp` renders with the variables the delivery intent
-- supplies ({{code}}, {{ttlMinutes}}). PLATFORM scope makes it available to every
-- tenant without per-tenant seeding; a tenant or organization may still author an
-- override at a higher-precedence scope (ORGANIZATION -> TENANT -> PLATFORM).
--
-- Seeding is idempotent: only inserted when no PLATFORM template already matches
-- this trigger/channel/locale.

INSERT INTO platform.communication_templates (
  scope, tenant_id, organization_id, trigger_key, channel, locale, content_format,
  subject, title, body, required_variables, default_variables, status
)
SELECT
  'PLATFORM', NULL, NULL, 'lead-capture.otp', 'email', 'en', 'TEXT',
  'Your verification code',
  'Verify your enquiry',
  'Your verification code is {{code}}. It expires in {{ttlMinutes}} minutes. '
    || 'If you did not request this, you can ignore this email.',
  '["code","ttlMinutes"]'::jsonb,
  '{}'::jsonb,
  'ACTIVE'
WHERE NOT EXISTS (
  SELECT 1 FROM platform.communication_templates
   WHERE scope = 'PLATFORM'
     AND trigger_key = 'lead-capture.otp'
     AND channel = 'email'
     AND locale = 'en'
);

COMMIT;
