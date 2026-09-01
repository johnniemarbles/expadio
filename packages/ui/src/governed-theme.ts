import {
  RepositoryEffectiveConfigurationService,
  type ConfigurationOverrideValidation,
  type ConfigurationResolutionContext,
  type ConfigurationValueCandidate,
  type EffectiveConfigurationService,
} from '@expadio/business-config';
import {
  EXPADIO_COMMAND_OBSIDIAN,
  type ExpadioThemeDefinition,
  type ThemeOverridePolicy,
  themeVariableMap,
} from './theme';

export const THEME_CONFIGURATION_SETTING_KEY = 'appearance.theme';

export interface GovernedThemeResolution {
  readonly theme: ExpadioThemeDefinition;
  readonly sourceLevel: string;
  readonly sourceRecordId: string | null;
  readonly fallback: boolean;
  readonly trace: readonly {
    readonly level: string;
    readonly recordId: string;
    readonly version: number;
    readonly outcome: string;
    readonly code: string;
  }[];
}

const CSS_VALUE_BLOCKLIST = /[;{}<>\r\n]/u;
const CSS_URL = /url\s*\(/iu;
const SAFE_KEY = /^[a-z0-9][a-z0-9._/-]{0,127}$/i;
const SAFE_HEX = /^#[0-9a-f]{6}$/i;

function safeCssValue(value: string): boolean {
  return value.length > 0
    && value.length <= 320
    && !CSS_VALUE_BLOCKLIST.test(value)
    && !CSS_URL.test(value);
}

function stringRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validPalette(value: unknown): boolean {
  if (!stringRecord(value)) return false;
  const required = [
    'canvas','surface','surfaceRaised','surfaceMuted','overlay','border',
    'textPrimary','textSecondary','textMuted','textInverse',
    'primary','secondary','accent','focus','success','warning','danger','info','neutral',
  ];
  if (!required.every((key) => typeof value[key] === 'string' && safeCssValue(value[key] as string))) return false;
  return Array.isArray(value.chart)
    && value.chart.length >= 3
    && value.chart.length <= 16
    && value.chart.every((entry) => typeof entry === 'string' && safeCssValue(entry));
}

function validPolicy(value: unknown): value is ThemeOverridePolicy {
  if (!stringRecord(value)) return false;
  return [
    'allowPrimary','allowSecondary','allowAccent','allowTypography','allowAssets','allowGeometry',
  ].every((key) => typeof value[key] === 'boolean');
}

function validStringSection(value: unknown, fields: readonly string[]): boolean {
  return stringRecord(value)
    && fields.every((field) => typeof value[field] === 'string' && safeCssValue(value[field] as string));
}

export function isExpadioThemeDefinition(value: unknown): value is ExpadioThemeDefinition {
  if (!stringRecord(value)) return false;
  if (value.schemaVersion !== 1) return false;
  if (typeof value.key !== 'string' || !SAFE_KEY.test(value.key)) return false;
  if (typeof value.name !== 'string' || value.name.trim() === '' || value.name.length > 100) return false;
  if (typeof value.description !== 'string' || value.description.length > 500) return false;
  if (!validPalette(value.light) || !validPalette(value.dark)) return false;
  if (!validStringSection(value.typography, [
    'uiFamily','displayFamily','monoFamily','baseSize','lineHeight','headingWeight','tracking',
  ])) return false;
  if (!stringRecord(value.geometry)
    || (value.geometry.density !== 'comfortable' && value.geometry.density !== 'compact')
    || !['pagePadding','sectionGap','cardGap','controlRadius','cardRadius','modalRadius']
      .every((field) => typeof value.geometry![field] === 'string' && safeCssValue(value.geometry![field] as string))) return false;
  if (!validStringSection(value.material, [
    'shadowSubtle','shadowCard','shadowElevated','blur','translucency','borderGlow',
  ])) return false;
  if (!validStringSection(value.motion, ['fast','normal','slow','easing'])) return false;
  if (!validStringSection(value.shell, [
    'sidebarWidth','headerHeight','sidebarSurfaceLight','sidebarSurfaceDark',
    'navigationActiveLight','navigationActiveDark','commandSurfaceLight','commandSurfaceDark',
  ])) return false;
  if (!stringRecord(value.assets)
    || typeof value.assets.brandName !== 'string'
    || value.assets.brandName.trim() === ''
    || value.assets.brandName.length > 100
    || ['logoUrl','faviconUrl','watermarkUrl'].some((field) =>
      value.assets![field] !== undefined
      && (typeof value.assets![field] !== 'string' || !/^https:\/\//i.test(value.assets![field] as string))
    )) return false;
  return validPolicy(value.overridePolicy);
}

function permittedBrandCandidate(
  current: ExpadioThemeDefinition,
  candidate: ExpadioThemeDefinition,
): boolean {
  const policy = current.overridePolicy;
  if (!same(current.overridePolicy, candidate.overridePolicy)) return false;
  if (!same(current.schemaVersion, candidate.schemaVersion)) return false;
  if (!same(current.key, candidate.key)) return false;
  if (!same(current.name, candidate.name)) return false;
  if (!same(current.description, candidate.description)) return false;
  if (!same(current.material, candidate.material)) return false;
  if (!same(current.motion, candidate.motion)) return false;
  if (!same(current.shell, candidate.shell)) return false;

  const lightProtected = {
    ...current.light,
    ...(policy.allowPrimary ? { primary: candidate.light.primary } : {}),
    ...(policy.allowSecondary ? { secondary: candidate.light.secondary } : {}),
    ...(policy.allowAccent ? { accent: candidate.light.accent, focus: candidate.light.focus } : {}),
  };
  const darkProtected = {
    ...current.dark,
    ...(policy.allowPrimary ? { primary: candidate.dark.primary } : {}),
    ...(policy.allowSecondary ? { secondary: candidate.dark.secondary } : {}),
    ...(policy.allowAccent ? { accent: candidate.dark.accent, focus: candidate.dark.focus } : {}),
  };
  if (!same(lightProtected, candidate.light) || !same(darkProtected, candidate.dark)) return false;

  if (!policy.allowTypography && !same(current.typography, candidate.typography)) return false;
  if (!policy.allowGeometry && !same(current.geometry, candidate.geometry)) return false;
  if (!policy.allowAssets && !same(current.assets, candidate.assets)) return false;

  if (policy.allowPrimary && (!SAFE_HEX.test(candidate.light.primary) || !SAFE_HEX.test(candidate.dark.primary))) return false;
  if (policy.allowSecondary && (!SAFE_HEX.test(candidate.light.secondary) || !SAFE_HEX.test(candidate.dark.secondary))) return false;
  if (policy.allowAccent && (
    !SAFE_HEX.test(candidate.light.accent)
    || !SAFE_HEX.test(candidate.dark.accent)
    || !SAFE_HEX.test(candidate.light.focus)
    || !SAFE_HEX.test(candidate.dark.focus)
  )) return false;

  return true;
}

/**
 * Bounded validator registered for appearance.theme.
 * Platform policy remains authoritative. PLAN/VERTICAL can select a complete
 * approved presentation profile but cannot weaken override governance.
 */
export function governedThemeOverrideValidator(input: {
  readonly current: ConfigurationValueCandidate;
  readonly candidate: ConfigurationValueCandidate;
}): ConfigurationOverrideValidation {
  if (!isExpadioThemeDefinition(input.current.value) || !isExpadioThemeDefinition(input.candidate.value)) {
    return {
      allowed: false,
      code: 'THEME_DEFINITION_INVALID',
      reason: 'Theme value does not satisfy the EXPADIO theme schema.',
    };
  }

  if (input.candidate.level === 'PLAN' || input.candidate.level === 'VERTICAL') {
    if (!same(input.current.value.overridePolicy, input.candidate.value.overridePolicy)) {
      return {
        allowed: false,
        code: 'THEME_OVERRIDE_POLICY_PROTECTED',
        reason: 'Plan and vertical profiles cannot change Platform override governance.',
      };
    }
    return {
      allowed: true,
      code: 'THEME_PROFILE_ALLOWED',
      reason: 'The complete presentation profile is valid and preserves Platform governance.',
    };
  }

  if (!['TENANT','BRAND','WORKSPACE'].includes(input.candidate.level)) {
    return {
      allowed: false,
      code: 'THEME_OVERRIDE_LEVEL_NOT_SUPPORTED',
      reason: 'This scope cannot override the corporate theme.',
    };
  }

  return permittedBrandCandidate(input.current.value, input.candidate.value)
    ? {
        allowed: true,
        code: 'THEME_OVERRIDE_WITHIN_POLICY',
        reason: 'The candidate changes only fields allowed by the inherited Platform policy.',
      }
    : {
        allowed: false,
        code: 'THEME_OVERRIDE_OUTSIDE_POLICY',
        reason: 'The candidate changes protected theme fields.',
      };
}

export async function resolveGovernedTheme(
  service: EffectiveConfigurationService,
  context: ConfigurationResolutionContext,
  effectiveAt: string = new Date().toISOString(),
): Promise<GovernedThemeResolution> {
  const result = await service.resolve({
    settingKey: THEME_CONFIGURATION_SETTING_KEY,
    context,
    effectiveAt,
  });

  if (result.status !== 'RESOLVED' || !isExpadioThemeDefinition(result.effectiveValue)) {
    return {
      theme: EXPADIO_COMMAND_OBSIDIAN,
      sourceLevel: 'PLATFORM_FALLBACK',
      sourceRecordId: null,
      fallback: true,
      trace: result.trace,
    };
  }

  return {
    theme: result.effectiveValue,
    sourceLevel: result.source.level,
    sourceRecordId: result.source.recordId,
    fallback: false,
    trace: result.trace,
  };
}

export function createEffectiveThemeService(input: {
  readonly definitions: ConstructorParameters<typeof RepositoryEffectiveConfigurationService>[0]['definitions'];
  readonly values: ConstructorParameters<typeof RepositoryEffectiveConfigurationService>[0]['values'];
}): EffectiveConfigurationService {
  return new RepositoryEffectiveConfigurationService(input);
}

function declarationBlock(values: Readonly<Record<string,string>>): string {
  return Object.entries(values)
    .map(([key,value]) => {
      if (!/^--theme-[a-z0-9-]+$/i.test(key) || !safeCssValue(value)) {
        throw new Error('THEME_CSS_VALUE_UNSAFE');
      }
      return `${key}:${value}`;
    })
    .join(';');
}

export function compileScopedThemeCss(
  theme: ExpadioThemeDefinition,
  scope: 'platform' | 'brand',
): string {
  if (!isExpadioThemeDefinition(theme)) throw new Error('THEME_DEFINITION_INVALID');
  const selector = `[data-expadio-theme="${scope}"]`;
  const light = declarationBlock(themeVariableMap(theme, 'light'));
  const dark = declarationBlock(themeVariableMap(theme, 'dark'));

  return [
    `${selector}{${light}}`,
    `[data-theme="dark"] ${selector},[data-theme="dark"]${selector}{${dark}}`,
    `@media (prefers-color-scheme:dark){[data-theme="system"] ${selector},[data-theme="system"]${selector}{${dark}}}`,
  ].join('');
}
