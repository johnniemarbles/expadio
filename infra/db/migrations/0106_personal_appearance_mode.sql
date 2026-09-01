BEGIN;

INSERT INTO platform.configuration_setting_definitions (
  definition_id, setting_key, version, value_schema, classification,
  override_mode, allowed_override_levels, authored_by_subject_id,
  authored_at, effective_from, reason, evidence_refs
) VALUES (
  '10600000-0000-0000-0000-000000000001'::uuid,
  'appearance.theme.mode',
  1,
  '{"type":"string","enum":["light","dark","system"]}'::jsonb,
  'PUBLIC',
  'OVERRIDABLE',
  ARRAY['USER_PREFERENCE'],
  'platform-theme-bootstrap',
  now(),
  '2026-09-01T00:00:00Z',
  'Persist each user''s presentation mode independently from governed theme tokens.',
  ARRAY['theme:personal-mode','architecture:governed-configuration']
)
ON CONFLICT (setting_key, version) DO NOTHING;

COMMIT;
