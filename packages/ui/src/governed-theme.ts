import {
  RepositoryEffectiveConfigurationService,
  type ConfigurationOverrideValidation,
  type ConfigurationResolutionContext,
  type ConfigurationResolutionLevel,
  type ConfigurationValueCandidate,
  type ConfigurationValueCandidateRepository,
  type EffectiveConfigurationService,
} from '@expadio/business-config';
import {
  EXPADIO_COMMAND_OBSIDIAN,
  type ExpadioThemeDefinition,
  type ThemeOverride,
  type ThemeOverridePolicy,
  resolveThemeOverride,
  themeVariableMap,
} from './theme';

export const THEME_PROFILE_SETTING_KEY = 'appearance.theme.profile';
export const THEME_OVERRIDE_SETTING_KEY = 'appearance.theme.override';

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
const OVERRIDE_KEYS = new Set([
  'primary','secondary','accent',
  'uiFamily','displayFamily','monoFamily',
  'brandName','logoUrl',
  'density','controlRadius','cardRadius',
]);

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
  const geometry=value.geometry;
  if (!stringRecord(geometry)
    || (geometry.density !== 'comfortable' && geometry.density !== 'compact')
    || !['pagePadding','sectionGap','cardGap','controlRadius','cardRadius','modalRadius']
      .every((field) => typeof geometry[field] === 'string' && safeCssValue(geometry[field] as string))) return false;
  if (!validStringSection(value.material, [
    'shadowSubtle','shadowCard','shadowElevated','blur','translucency','borderGlow',
  ])) return false;
  if (!validStringSection(value.motion, [
    'instant','fast','normal','slow','panel','data',
    'distanceMicro','distanceSmall','distancePanel',
    'easing','easingEmphasis','easingLinear',
  ])) return false;
  if (!validStringSection(value.shell, [
    'sidebarWidth','headerHeight','sidebarSurfaceLight','sidebarSurfaceDark',
    'navigationActiveLight','navigationActiveDark','commandSurfaceLight','commandSurfaceDark',
  ])) return false;
  const assets=value.assets;
  if (!stringRecord(assets)
    || typeof assets.brandName !== 'string'
    || assets.brandName.trim() === ''
    || assets.brandName.length > 100
    || ['logoUrl','faviconUrl','watermarkUrl'].some((field) =>
      assets[field] !== undefined
      && (typeof assets[field] !== 'string' || !/^https:\/\//i.test(assets[field] as string))
    )) return false;
  return validPolicy(value.overridePolicy);
}

export function isThemeOverride(value: unknown): value is ThemeOverride {
  if (!stringRecord(value)) return false;
  if (Object.keys(value).some((key) => !OVERRIDE_KEYS.has(key))) return false;

  for (const field of ['primary','secondary','accent'] as const) {
    const candidate = value[field];
    if (candidate !== undefined && (typeof candidate !== 'string' || !SAFE_HEX.test(candidate))) return false;
  }

  for (const field of ['uiFamily','displayFamily','monoFamily','controlRadius','cardRadius'] as const) {
    const candidate = value[field];
    if (candidate !== undefined && (typeof candidate !== 'string' || !safeCssValue(candidate))) return false;
  }

  if (value.brandName !== undefined && (
    typeof value.brandName !== 'string'
    || value.brandName.trim() === ''
    || value.brandName.length > 100
    || CSS_VALUE_BLOCKLIST.test(value.brandName)
  )) return false;

  if (value.logoUrl !== undefined && (
    typeof value.logoUrl !== 'string'
    || !/^https:\/\//i.test(value.logoUrl)
  )) return false;

  if (value.density !== undefined && value.density !== 'comfortable' && value.density !== 'compact') return false;
  return true;
}

/**
 * PLAN and VERTICAL may select a complete presentation profile but cannot
 * weaken the Platform's brand-override policy.
 */
export function governedThemeProfileValidator(input: {
  readonly current: ConfigurationValueCandidate;
  readonly candidate: ConfigurationValueCandidate;
}): ConfigurationOverrideValidation {
  if (!isExpadioThemeDefinition(input.current.value) || !isExpadioThemeDefinition(input.candidate.value)) {
    return {
      allowed: false,
      code: 'THEME_PROFILE_INVALID',
      reason: 'Theme profile does not satisfy the EXPADIO theme schema.',
    };
  }

  if (input.candidate.level !== 'PLAN' && input.candidate.level !== 'VERTICAL') {
    return {
      allowed: false,
      code: 'THEME_PROFILE_LEVEL_NOT_SUPPORTED',
      reason: 'Only Plan and Vertical defaults may replace the inherited Platform profile.',
    };
  }

  if (!same(input.current.value.overridePolicy, input.candidate.value.overridePolicy)) {
    return {
      allowed: false,
      code: 'THEME_OVERRIDE_POLICY_PROTECTED',
      reason: 'Plan and Vertical profiles cannot change Platform override governance.',
    };
  }

  return {
    allowed: true,
    code: 'THEME_PROFILE_ALLOWED',
    reason: 'The complete presentation profile is valid and preserves Platform governance.',
  };
}

export function validateThemeOverrideAgainstPolicy(
  theme: ExpadioThemeDefinition,
  patch: ThemeOverride,
): ConfigurationOverrideValidation {
  const policy = theme.overridePolicy;

  if ((patch.primary !== undefined && !policy.allowPrimary)
    || (patch.secondary !== undefined && !policy.allowSecondary)
    || (patch.accent !== undefined && !policy.allowAccent)) {
    return {
      allowed: false,
      code: 'THEME_COLOR_OVERRIDE_LOCKED',
      reason: 'The inherited Platform policy locks one or more requested brand colors.',
    };
  }

  if ((patch.uiFamily !== undefined || patch.displayFamily !== undefined || patch.monoFamily !== undefined)
    && !policy.allowTypography) {
    return {
      allowed: false,
      code: 'THEME_TYPOGRAPHY_OVERRIDE_LOCKED',
      reason: 'Typography overrides are locked by the inherited Platform policy.',
    };
  }

  if ((patch.brandName !== undefined || patch.logoUrl !== undefined) && !policy.allowAssets) {
    return {
      allowed: false,
      code: 'THEME_ASSET_OVERRIDE_LOCKED',
      reason: 'Brand asset overrides are locked by the inherited Platform policy.',
    };
  }

  if ((patch.density !== undefined || patch.controlRadius !== undefined || patch.cardRadius !== undefined)
    && !policy.allowGeometry) {
    return {
      allowed: false,
      code: 'THEME_GEOMETRY_OVERRIDE_LOCKED',
      reason: 'Geometry overrides are locked by the inherited Platform policy.',
    };
  }

  return {
    allowed: true,
    code: 'THEME_OVERRIDE_WITHIN_POLICY',
    reason: 'The patch changes only fields permitted by the inherited Platform policy.',
  };
}

const OVERRIDE_LEVEL_ORDER: Readonly<Record<string, number>> = {
  TENANT: 0,
  BRAND: 1,
  WORKSPACE: 2,
};

function traceEntry(
  candidate: ConfigurationValueCandidate,
  outcome: 'APPLIED' | 'REJECTED',
  code: string,
) {
  return {
    level: candidate.level,
    recordId: candidate.recordId,
    version: candidate.version,
    outcome,
    code,
  };
}

export async function resolveGovernedTheme(
  profileService: EffectiveConfigurationService,
  values: ConfigurationValueCandidateRepository,
  context: ConfigurationResolutionContext,
  effectiveAt: string = new Date().toISOString(),
): Promise<GovernedThemeResolution> {
  const profile = await profileService.resolve({
    settingKey: THEME_PROFILE_SETTING_KEY,
    context,
    effectiveAt,
  });

  let theme = profile.status === 'RESOLVED' && isExpadioThemeDefinition(profile.effectiveValue)
    ? profile.effectiveValue
    : EXPADIO_COMMAND_OBSIDIAN;
  let sourceLevel = profile.status === 'RESOLVED' ? profile.source.level : 'PLATFORM_FALLBACK';
  let sourceRecordId = profile.status === 'RESOLVED' ? profile.source.recordId : null;
  const trace = [...profile.trace];

  const patches = await values.listCandidates({
    settingKey: THEME_OVERRIDE_SETTING_KEY,
    context,
    effectiveAt,
  });

  const ordered = [...patches]
    .filter((candidate) => ['TENANT','BRAND','WORKSPACE'].includes(candidate.level))
    .sort((left,right) =>
      (OVERRIDE_LEVEL_ORDER[left.level] ?? 99) - (OVERRIDE_LEVEL_ORDER[right.level] ?? 99)
      || left.version - right.version
      || left.recordId.localeCompare(right.recordId)
    );

  const selectedByLevel = new Map<ConfigurationResolutionLevel, ConfigurationValueCandidate>();
  for (const candidate of ordered) {
    const current = selectedByLevel.get(candidate.level);
    if (current === undefined || candidate.version > current.version) {
      selectedByLevel.set(candidate.level, candidate);
    }
  }

  for (const level of ['TENANT','BRAND','WORKSPACE'] as const) {
    const candidate = selectedByLevel.get(level);
    if (candidate === undefined) continue;

    if (!isThemeOverride(candidate.value)) {
      trace.push(traceEntry(candidate, 'REJECTED', 'THEME_OVERRIDE_INVALID'));
      continue;
    }

    const validation = validateThemeOverrideAgainstPolicy(theme, candidate.value);
    if (!validation.allowed) {
      trace.push(traceEntry(candidate, 'REJECTED', validation.code));
      continue;
    }

    theme = resolveThemeOverride(theme, candidate.value);
    sourceLevel = candidate.level;
    sourceRecordId = candidate.recordId;
    trace.push(traceEntry(candidate, 'APPLIED', validation.code));
  }

  return {
    theme,
    sourceLevel,
    sourceRecordId,
    fallback: profile.status !== 'RESOLVED',
    trace,
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
