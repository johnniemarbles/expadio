BEGIN;

-- Personal appearance is a user comfort preference only. It selects how the
-- already-governed Platform/Brand theme is displayed; it must never introduce
-- colors, token overrides, CSS, JavaScript, module navigation, or shared tenant
-- policy changes.
INSERT INTO platform.configuration_setting_definitions (
  definition_id, setting_key, version, value_schema, classification,
  override_mode, allowed_override_levels, authored_by_subject_id,
  authored_at, effective_from, reason, evidence_refs
) VALUES (
  '10600000-0000-0000-0000-000000000001'::uuid,
  'appearance.theme.mode',
  1,
  '{"enum":["light","dark","system"]}'::jsonb,
  'PUBLIC',
  'BOUNDED',
  ARRAY['USER_PREFERENCE'],
  'platform-theme-bootstrap',
  now(),
  '2026-09-01T00:00:00Z',
  'Allow each authenticated user to persist only their preferred appearance mode.',
  ARRAY['theme:personal-mode','architecture:governed-configuration']
)
ON CONFLICT (setting_key, version) DO NOTHING;

COMMIT;
