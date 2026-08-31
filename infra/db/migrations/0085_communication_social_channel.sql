-- Social Content Communication wiring — platform slice.
--
-- Freeze exception 2026-08-31 after lab close-out of
-- johnniemarbles/expadio-social-content 0.6.2.
-- Binding: ADR-007 (social send is a Communication connector, not PUBLISH_SOCIAL).
--
-- Numbered 0085 so it does not collide with draft #475 (0083/0084).
--
-- Binding rules this migration must not violate:
--   * Communication owns send. Connector social.linkedin is seeded DISABLED.
--   * Do not enable the connector. Do not invent provider_message_id.
--   * Do not add social to communication_sender_identities (not a sender channel).
--   * Do not merge Decision Fabric PR #482 from this slice.

-- ---------------------------------------------------------------------------
-- Widen lowercase Communication channel CHECKs with 'social'.
-- Sender-identity CHECK stays email/sms/whatsapp/voice/rcs.
-- Control-plane 0038 uses a different (uppercase) vocabulary and is left alone.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rec record;
  def text;
  nullable boolean;
BEGIN
  FOR rec IN
    SELECT n.nspname AS schema_name,
           t.relname AS table_name,
           c.conname,
           pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE c.contype = 'c'
       AND n.nspname = 'platform'
       AND t.relname IN (
         'communication_templates',
         'communication_deliveries',
         'communication_suppressions',
         'communication_conversations',
         'communication_consent_events'
       )
       AND pg_get_constraintdef(c.oid) LIKE '%channel IN (%'
       AND pg_get_constraintdef(c.oid) LIKE '%''email''%'
       AND pg_get_constraintdef(c.oid) NOT LIKE '%''social''%'
  LOOP
    def := rec.definition;
    nullable := def ILIKE '%channel IS NULL%' OR rec.table_name = 'communication_conversations';
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', rec.schema_name, rec.table_name, rec.conname);
    IF nullable THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (channel IS NULL OR channel IN (''email'',''sms'',''whatsapp'',''voice'',''in_app'',''push'',''rcs'',''social''))',
        rec.schema_name, rec.table_name, rec.conname
      );
    ELSE
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (channel IN (''email'',''sms'',''whatsapp'',''voice'',''in_app'',''push'',''rcs'',''social''))',
        rec.schema_name, rec.table_name, rec.conname
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Capability + disabled LinkedIn connector (Resend/gtm.email pattern).
-- ---------------------------------------------------------------------------
INSERT INTO platform.capabilities (capability_key, display_name, permitted_modes, enabled)
VALUES ('communication.social.send', 'Social — Send', ARRAY['A']::text[], true)
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO platform.connectors (
  connector_key, provider_type, provider_key, ownership_scope, tenant_id,
  health, priority, enabled, fallback_enabled
)
VALUES (
  'social.linkedin', 'social', 'linkedin', 'PLATFORM', NULL,
  'UNKNOWN', 200, false, false
)
ON CONFLICT (connector_key) DO NOTHING;

INSERT INTO platform.connector_capabilities (connector_id, capability_id)
SELECT c.connector_id, cap.capability_id
  FROM platform.connectors c
  JOIN platform.capabilities cap ON cap.capability_key = 'communication.social.send'
 WHERE c.connector_key = 'social.linkedin'
ON CONFLICT DO NOTHING;
