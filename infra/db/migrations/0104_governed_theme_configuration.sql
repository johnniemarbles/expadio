BEGIN;

INSERT INTO platform.configuration_setting_definitions (
  definition_id, setting_key, version, value_schema, classification,
  override_mode, allowed_override_levels, authored_by_subject_id,
  authored_at, effective_from, reason, evidence_refs
) VALUES (
  '10400000-0000-0000-0000-000000000001'::uuid,
  'appearance.theme',
  1,
  '{"type":"object","required":["schemaVersion","key","light","dark","overridePolicy"]}'::jsonb,
  'INTERNAL',
  'BOUNDED',
  ARRAY['PLAN','VERTICAL','TENANT','BRAND','WORKSPACE'],
  'platform-theme-bootstrap',
  now(),
  '2026-09-01T00:00:00Z',
  'Establish governed EXPADIO theme inheritance.',
  ARRAY['theme:expadio-command-obsidian','architecture:governed-configuration']
)
ON CONFLICT (setting_key, version) DO NOTHING;

INSERT INTO platform.configuration_setting_values (
  value_id, setting_key, definition_version, level, scope_id, tenant_id,
  record_version, value, effective_from, effective_until,
  authored_by_subject_id, authored_at, reason, correlation_id, evidence_refs
) VALUES (
  '10400000-0000-0000-0000-000000000011'::uuid,
  'appearance.theme',
  1,
  'PLATFORM',
  NULL,
  NULL,
  1,
  '{"schemaVersion":1,"key":"expadio-command-obsidian","name":"EXPADIO Command / Obsidian","description":"Deep operational surfaces with restrained cyan/violet telemetry accents.","light":{"canvas":"#f5f8fb","surface":"#ffffff","surfaceRaised":"#ffffff","surfaceMuted":"#eef3f8","overlay":"rgba(7, 15, 27, 0.42)","border":"rgba(23, 49, 77, 0.12)","textPrimary":"#102033","textSecondary":"#52657a","textMuted":"#74869a","textInverse":"#f7fbff","primary":"#0891b2","secondary":"#7c3aed","accent":"#06b6d4","focus":"#0284c7","success":"#0f9f73","warning":"#b77906","danger":"#dc3f59","info":"#2563eb","neutral":"#64748b","chart":["#06b6d4","#6366f1","#8b5cf6","#f59e0b","#10b981","#3b82f6","#e11d48"]},"dark":{"canvas":"#05080d","surface":"#0a1018","surfaceRaised":"#0e1722","surfaceMuted":"#111c29","overlay":"rgba(0, 4, 10, 0.72)","border":"rgba(104, 151, 190, 0.18)","textPrimary":"#edf7ff","textSecondary":"#a8bbcc","textMuted":"#71869a","textInverse":"#041018","primary":"#22d3ee","secondary":"#8b5cf6","accent":"#06b6d4","focus":"#67e8f9","success":"#2dd4a3","warning":"#fbbf24","danger":"#fb7185","info":"#60a5fa","neutral":"#94a3b8","chart":["#22d3ee","#6366f1","#a855f7","#fbbf24","#2dd4a3","#60a5fa","#fb7185"]},"typography":{"uiFamily":"Inter, Geist, ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif","displayFamily":"Inter, Geist, ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif","monoFamily":"\"JetBrains Mono\", \"SFMono-Regular\", Consolas, ui-monospace, monospace","baseSize":"14px","lineHeight":"1.5","headingWeight":"700","tracking":"-0.015em"},"geometry":{"density":"comfortable","pagePadding":"28px","sectionGap":"20px","cardGap":"14px","controlRadius":"9px","cardRadius":"14px","modalRadius":"18px"},"material":{"shadowSubtle":"0 1px 2px rgba(0,0,0,.16)","shadowCard":"0 12px 36px rgba(0,0,0,.18)","shadowElevated":"0 24px 70px rgba(0,0,0,.28)","blur":"18px","translucency":".94","borderGlow":"0 0 0 1px rgba(34,211,238,.08)"},"motion":{"fast":"140ms","normal":"220ms","slow":"340ms","easing":"cubic-bezier(.2,.8,.2,1)"},"shell":{"sidebarWidth":"228px","headerHeight":"64px","sidebarSurfaceLight":"#ffffff","sidebarSurfaceDark":"#060b12","navigationActiveLight":"rgba(6,182,212,.10)","navigationActiveDark":"rgba(34,211,238,.12)","commandSurfaceLight":"#eef3f8","commandSurfaceDark":"#0b141f"},"assets":{"brandName":"EXPADIO"},"overridePolicy":{"allowPrimary":true,"allowSecondary":true,"allowAccent":true,"allowTypography":false,"allowAssets":true,"allowGeometry":false}}'::jsonb,
  '2026-09-01T00:00:00Z',
  NULL,
  'platform-theme-bootstrap',
  now(),
  'Publish EXPADIO Command / Obsidian as the Platform baseline.',
  '10400000-0000-0000-0000-000000000101'::uuid,
  ARRAY['theme:expadio-command-obsidian','preset:platform-default']
)
ON CONFLICT (setting_key, level, COALESCE(scope_id, ''), record_version) DO NOTHING;

COMMIT;
