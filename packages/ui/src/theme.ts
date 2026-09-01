export type ThemeMode = 'light' | 'dark' | 'system';

export interface SemanticPalette {
  readonly canvas: string;
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly surfaceMuted: string;
  readonly overlay: string;
  readonly border: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly textInverse: string;
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
  readonly focus: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
  readonly info: string;
  readonly neutral: string;
  readonly chart: readonly string[];
}

export interface ThemeTypography {
  readonly uiFamily: string;
  readonly displayFamily: string;
  readonly monoFamily: string;
  readonly baseSize: string;
  readonly lineHeight: string;
  readonly headingWeight: string;
  readonly tracking: string;
}

export interface ThemeGeometry {
  readonly density: 'comfortable' | 'compact';
  readonly pagePadding: string;
  readonly sectionGap: string;
  readonly cardGap: string;
  readonly controlRadius: string;
  readonly cardRadius: string;
  readonly modalRadius: string;
}

export interface ThemeMaterial {
  readonly shadowSubtle: string;
  readonly shadowCard: string;
  readonly shadowElevated: string;
  readonly blur: string;
  readonly translucency: string;
  readonly borderGlow: string;
}

export interface ThemeMotion {
  readonly fast: string;
  readonly normal: string;
  readonly slow: string;
  readonly easing: string;
}

export interface ThemeShellTokens {
  readonly sidebarWidth: string;
  readonly headerHeight: string;
  readonly sidebarSurfaceLight: string;
  readonly sidebarSurfaceDark: string;
  readonly navigationActiveLight: string;
  readonly navigationActiveDark: string;
  readonly commandSurfaceLight: string;
  readonly commandSurfaceDark: string;
}

export interface ThemeAssets {
  readonly brandName: string;
  readonly logoUrl?: string;
  readonly faviconUrl?: string;
  readonly watermarkUrl?: string;
}

export interface ThemeOverridePolicy {
  readonly allowPrimary: boolean;
  readonly allowSecondary: boolean;
  readonly allowAccent: boolean;
  readonly allowTypography: boolean;
  readonly allowAssets: boolean;
  readonly allowGeometry: boolean;
}

export interface ExpadioThemeDefinition {
  readonly schemaVersion: 1;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly light: SemanticPalette;
  readonly dark: SemanticPalette;
  readonly typography: ThemeTypography;
  readonly geometry: ThemeGeometry;
  readonly material: ThemeMaterial;
  readonly motion: ThemeMotion;
  readonly shell: ThemeShellTokens;
  readonly assets: ThemeAssets;
  readonly overridePolicy: ThemeOverridePolicy;
}

export interface ThemeOverride {
  readonly primary?: string;
  readonly secondary?: string;
  readonly accent?: string;
  readonly uiFamily?: string;
  readonly displayFamily?: string;
  readonly monoFamily?: string;
  readonly brandName?: string;
  readonly logoUrl?: string;
  readonly density?: ThemeGeometry['density'];
  readonly controlRadius?: string;
  readonly cardRadius?: string;
}

const DEFAULT_POLICY: ThemeOverridePolicy = {
  allowPrimary: true,
  allowSecondary: true,
  allowAccent: true,
  allowTypography: false,
  allowAssets: true,
  allowGeometry: false,
};

const OBSIDIAN_LIGHT: SemanticPalette = {
  canvas: '#f5f8fb',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  surfaceMuted: '#eef3f8',
  overlay: 'rgba(7, 15, 27, 0.42)',
  border: 'rgba(23, 49, 77, 0.12)',
  textPrimary: '#102033',
  textSecondary: '#52657a',
  textMuted: '#74869a',
  textInverse: '#f7fbff',
  primary: '#0891b2',
  secondary: '#7c3aed',
  accent: '#06b6d4',
  focus: '#0284c7',
  success: '#0f9f73',
  warning: '#b77906',
  danger: '#dc3f59',
  info: '#2563eb',
  neutral: '#64748b',
  chart: ['#06b6d4','#6366f1','#8b5cf6','#f59e0b','#10b981','#3b82f6','#e11d48'],
};

const OBSIDIAN_DARK: SemanticPalette = {
  canvas: '#05080d',
  surface: '#0a1018',
  surfaceRaised: '#0e1722',
  surfaceMuted: '#111c29',
  overlay: 'rgba(0, 4, 10, 0.72)',
  border: 'rgba(104, 151, 190, 0.18)',
  textPrimary: '#edf7ff',
  textSecondary: '#a8bbcc',
  textMuted: '#71869a',
  textInverse: '#041018',
  primary: '#22d3ee',
  secondary: '#8b5cf6',
  accent: '#06b6d4',
  focus: '#67e8f9',
  success: '#2dd4a3',
  warning: '#fbbf24',
  danger: '#fb7185',
  info: '#60a5fa',
  neutral: '#94a3b8',
  chart: ['#22d3ee','#6366f1','#a855f7','#fbbf24','#2dd4a3','#60a5fa','#fb7185'],
};

export const EXPADIO_COMMAND_OBSIDIAN: ExpadioThemeDefinition = {
  schemaVersion: 1,
  key: 'expadio-command-obsidian',
  name: 'EXPADIO Command / Obsidian',
  description: 'Deep operational surfaces with restrained cyan/violet telemetry accents.',
  light: OBSIDIAN_LIGHT,
  dark: OBSIDIAN_DARK,
  typography: {
    uiFamily: 'Inter, Geist, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    displayFamily: 'Inter, Geist, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    monoFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, ui-monospace, monospace',
    baseSize: '14px',
    lineHeight: '1.5',
    headingWeight: '700',
    tracking: '-0.015em',
  },
  geometry: {
    density: 'comfortable',
    pagePadding: '28px',
    sectionGap: '20px',
    cardGap: '14px',
    controlRadius: '9px',
    cardRadius: '14px',
    modalRadius: '18px',
  },
  material: {
    shadowSubtle: '0 1px 2px rgba(0,0,0,.16)',
    shadowCard: '0 12px 36px rgba(0,0,0,.18)',
    shadowElevated: '0 24px 70px rgba(0,0,0,.28)',
    blur: '18px',
    translucency: '.94',
    borderGlow: '0 0 0 1px rgba(34,211,238,.08)',
  },
  motion: {
    fast: '140ms',
    normal: '220ms',
    slow: '340ms',
    easing: 'cubic-bezier(.2,.8,.2,1)',
  },
  shell: {
    sidebarWidth: '228px',
    headerHeight: '64px',
    sidebarSurfaceLight: '#ffffff',
    sidebarSurfaceDark: '#060b12',
    navigationActiveLight: 'rgba(6,182,212,.10)',
    navigationActiveDark: 'rgba(34,211,238,.12)',
    commandSurfaceLight: '#eef3f8',
    commandSurfaceDark: '#0b141f',
  },
  assets: { brandName: 'EXPADIO' },
  overridePolicy: DEFAULT_POLICY,
};

export const EXPADIO_ENTERPRISE: ExpadioThemeDefinition = {
  ...EXPADIO_COMMAND_OBSIDIAN,
  key: 'expadio-enterprise',
  name: 'EXPADIO Enterprise',
  description: 'Neutral enterprise surfaces with restrained blue accents and compact operational density.',
  light: {
    ...OBSIDIAN_LIGHT,
    canvas: '#f7f8fa',
    surfaceMuted: '#f0f2f5',
    primary: '#2563eb',
    accent: '#2563eb',
    focus: '#2563eb',
  },
  dark: {
    ...OBSIDIAN_DARK,
    canvas: '#0a0d12',
    surface: '#11151b',
    surfaceRaised: '#151b23',
    primary: '#60a5fa',
    accent: '#60a5fa',
    focus: '#93c5fd',
  },
  geometry: {
    ...EXPADIO_COMMAND_OBSIDIAN.geometry,
    density: 'compact',
    pagePadding: '22px',
    cardGap: '12px',
    controlRadius: '7px',
    cardRadius: '10px',
  },
};

export const EXPADIO_THEME_PRESETS = {
  [EXPADIO_COMMAND_OBSIDIAN.key]: EXPADIO_COMMAND_OBSIDIAN,
  [EXPADIO_ENTERPRISE.key]: EXPADIO_ENTERPRISE,
} as const;

function isSafeColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function resolveThemeOverride(
  base: ExpadioThemeDefinition,
  override: ThemeOverride = {},
): ExpadioThemeDefinition {
  const policy = base.overridePolicy;
  const primary = policy.allowPrimary && override.primary && isSafeColor(override.primary)
    ? override.primary
    : null;
  const secondary = policy.allowSecondary && override.secondary && isSafeColor(override.secondary)
    ? override.secondary
    : null;
  const accent = policy.allowAccent && override.accent && isSafeColor(override.accent)
    ? override.accent
    : null;

  return {
    ...base,
    light: {
      ...base.light,
      ...(primary ? { primary } : {}),
      ...(secondary ? { secondary } : {}),
      ...(accent ? { accent, focus: accent } : {}),
    },
    dark: {
      ...base.dark,
      ...(primary ? { primary } : {}),
      ...(secondary ? { secondary } : {}),
      ...(accent ? { accent, focus: accent } : {}),
    },
    typography: policy.allowTypography
      ? {
          ...base.typography,
          ...(override.uiFamily ? { uiFamily: override.uiFamily } : {}),
          ...(override.displayFamily ? { displayFamily: override.displayFamily } : {}),
          ...(override.monoFamily ? { monoFamily: override.monoFamily } : {}),
        }
      : base.typography,
    geometry: policy.allowGeometry
      ? {
          ...base.geometry,
          ...(override.density ? { density: override.density } : {}),
          ...(override.controlRadius ? { controlRadius: override.controlRadius } : {}),
          ...(override.cardRadius ? { cardRadius: override.cardRadius } : {}),
        }
      : base.geometry,
    assets: policy.allowAssets
      ? {
          ...base.assets,
          ...(override.brandName ? { brandName: override.brandName } : {}),
          ...(override.logoUrl ? { logoUrl: override.logoUrl } : {}),
        }
      : base.assets,
  };
}

export function themeVariableMap(
  theme: ExpadioThemeDefinition,
  mode: 'light' | 'dark',
): Readonly<Record<string, string>> {
  const p = theme[mode];
  return {
    '--theme-canvas': p.canvas,
    '--theme-surface': p.surface,
    '--theme-surface-raised': p.surfaceRaised,
    '--theme-surface-muted': p.surfaceMuted,
    '--theme-overlay': p.overlay,
    '--theme-border': p.border,
    '--theme-text-primary': p.textPrimary,
    '--theme-text-secondary': p.textSecondary,
    '--theme-text-muted': p.textMuted,
    '--theme-text-inverse': p.textInverse,
    '--theme-primary': p.primary,
    '--theme-secondary': p.secondary,
    '--theme-accent': p.accent,
    '--theme-focus': p.focus,
    '--theme-success': p.success,
    '--theme-warning': p.warning,
    '--theme-danger': p.danger,
    '--theme-info': p.info,
    '--theme-neutral': p.neutral,
    '--theme-font-ui': theme.typography.uiFamily,
    '--theme-font-display': theme.typography.displayFamily,
    '--theme-font-mono': theme.typography.monoFamily,
    '--theme-font-size': theme.typography.baseSize,
    '--theme-line-height': theme.typography.lineHeight,
    '--theme-heading-weight': theme.typography.headingWeight,
    '--theme-tracking': theme.typography.tracking,
    '--theme-page-padding': theme.geometry.pagePadding,
    '--theme-section-gap': theme.geometry.sectionGap,
    '--theme-card-gap': theme.geometry.cardGap,
    '--theme-radius-control': theme.geometry.controlRadius,
    '--theme-radius-card': theme.geometry.cardRadius,
    '--theme-radius-modal': theme.geometry.modalRadius,
    '--theme-shadow-subtle': theme.material.shadowSubtle,
    '--theme-shadow-card': theme.material.shadowCard,
    '--theme-shadow-elevated': theme.material.shadowElevated,
    '--theme-blur': theme.material.blur,
    '--theme-translucency': theme.material.translucency,
    '--theme-border-glow': theme.material.borderGlow,
    '--theme-motion-fast': theme.motion.fast,
    '--theme-motion-normal': theme.motion.normal,
    '--theme-motion-slow': theme.motion.slow,
    '--theme-easing': theme.motion.easing,
    '--theme-sidebar-width': theme.shell.sidebarWidth,
    '--theme-header-height': theme.shell.headerHeight,
    '--theme-sidebar-surface': mode === 'dark' ? theme.shell.sidebarSurfaceDark : theme.shell.sidebarSurfaceLight,
    '--theme-navigation-active': mode === 'dark' ? theme.shell.navigationActiveDark : theme.shell.navigationActiveLight,
    '--theme-command-surface': mode === 'dark' ? theme.shell.commandSurfaceDark : theme.shell.commandSurfaceLight,
  };
}
