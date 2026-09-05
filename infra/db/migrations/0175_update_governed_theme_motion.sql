-- Migration 0175: Update platform baseline governed theme profile to Motion aesthetic
-- Overwrites stored configuration setting value for appearance.theme.profile in platform.configuration_setting_values with Motion theme specification (#060707 dark charcoal canvas, #0c0e0d surface, #1e2220 border, #facc15 yellow primary, #a88cf8 purple secondary, razor sharp 0-2px radii).

UPDATE platform.configuration_setting_values
SET value = '{
  "schemaVersion": 1,
  "key": "expadio-command-obsidian",
  "name": "EXPADIO Command / Obsidian",
  "description": "Dark charcoal surfaces with Motion yellow and purple accents, sharp 0-2px radii, and physics spring transitions.",
  "light": {
    "canvas": "#f5f8fb", "surface": "#ffffff", "surfaceRaised": "#ffffff", "surfaceMuted": "#eef3f8",
    "overlay": "rgba(7, 15, 27, 0.42)", "border": "rgba(23, 49, 77, 0.12)",
    "textPrimary": "#102033", "textSecondary": "#52657a", "textMuted": "#74869a", "textInverse": "#f7fbff",
    "primary": "#ca8a04", "secondary": "#7c3aed", "accent": "#ca8a04", "focus": "#a16207",
    "success": "#16a34a", "warning": "#b45309", "danger": "#dc2626", "info": "#2563eb", "neutral": "#64748b",
    "chart": ["#ca8a04", "#6366f1", "#8b5cf6", "#f59e0b", "#10b981", "#3b82f6", "#e11d48"]
  },
  "dark": {
    "canvas": "#060707", "surface": "#0c0e0d", "surfaceRaised": "#121514", "surfaceMuted": "#171a19",
    "overlay": "rgba(6, 7, 7, 0.85)", "border": "#1e2220",
    "textPrimary": "#ededed", "textSecondary": "#a1a1a1", "textMuted": "#666666", "textInverse": "#060707",
    "primary": "#facc15", "secondary": "#a88cf8", "accent": "#fde047", "focus": "#fde047",
    "success": "#22c55e", "warning": "#f59e0b", "danger": "#ef4444", "info": "#3b82f6", "neutral": "#666666",
    "chart": ["#facc15", "#a88cf8", "#f472b6", "#34d399", "#60a5fa", "#fb923c", "#f87171"]
  },
  "typography": {
    "uiFamily": "Inter, Geist, ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
    "displayFamily": "Inter, Geist, ui-sans-serif, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
    "monoFamily": "\"JetBrains Mono\", \"SFMono-Regular\", Consolas, ui-monospace, monospace",
    "baseSize": "14px", "lineHeight": "1.5", "headingWeight": "700", "tracking": "-0.015em"
  },
  "geometry": {
    "density": "comfortable", "pagePadding": "28px", "sectionGap": "20px", "cardGap": "14px",
    "controlRadius": "2px", "cardRadius": "2px", "modalRadius": "4px"
  },
  "material": {
    "shadowSubtle": "0 1px 2px rgba(0, 0, 0, 0.6)", "shadowCard": "0 4px 12px rgba(0, 0, 0, 0.5)",
    "shadowElevated": "0 8px 24px rgba(0, 0, 0, 0.55)", "blur": "18px", "translucency": ".94",
    "borderGlow": "0 0 0 1px rgba(250, 204, 21, 0.25)"
  },
  "motion": {
    "instant": "0ms", "fast": "120ms", "normal": "200ms", "slow": "320ms", "panel": "360ms", "data": "700ms",
    "distanceMicro": "2px", "distanceSmall": "4px", "distancePanel": "24px",
    "easing": "cubic-bezier(0.4, 0, 0.2, 1)", "easingEmphasis": "cubic-bezier(0.2, 0.9, 0.2, 1.2)", "easingLinear": "linear"
  },
  "shell": {
    "sidebarWidth": "228px", "headerHeight": "64px",
    "sidebarSurfaceLight": "#ffffff", "sidebarSurfaceDark": "#0c0e0d",
    "navigationActiveLight": "rgba(202, 138, 4, 0.10)", "navigationActiveDark": "rgba(250, 204, 21, 0.15)",
    "commandSurfaceLight": "#eef3f8", "commandSurfaceDark": "#0c0e0d"
  },
  "assets": { "brandName": "EXPADIO" },
  "overridePolicy": {
    "allowPrimary": true, "allowSecondary": true, "allowAccent": true,
    "allowTypography": false, "allowAssets": true, "allowGeometry": false
  }
}'::jsonb
WHERE setting_key = 'appearance.theme.profile';
