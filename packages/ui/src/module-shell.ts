export interface ModuleSectionDescriptor {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly placement: 'primary' | 'more';
  readonly requiredCapabilities: readonly string[];
}

export interface ModuleQuickActionDescriptor {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly requiredCapabilities: readonly string[];
}

export interface ModuleShellDescriptor {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly iconKey: string;
  readonly baseRoute: string;
  readonly defaultPinned: boolean;
  readonly order: number;
  readonly sections: readonly ModuleSectionDescriptor[];
  readonly quickActions: readonly ModuleQuickActionDescriptor[];
}

export interface ProductModuleShellInput {
  readonly moduleKey: string;
  readonly displayName: string;
  readonly description: string;
  readonly manifest: Readonly<Record<string, unknown>>;
}

function safePath(value: unknown): string | null {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('\\')
    ? value
    : null;
}

function safeToken(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value)
    ? value
    : fallback;
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 120)
    .slice(0, 32);
}

function parseSections(value: unknown): readonly ModuleSectionDescriptor[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: ModuleSectionDescriptor[] = [];
  for (const candidate of value.slice(0, 24)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    const id = safeToken(item.id, '');
    const href = safePath(item.href);
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!id || !href || !label || label.length > 60 || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      label,
      href,
      placement: item.placement === 'more' ? 'more' : 'primary',
      requiredCapabilities: stringList(item.requiredCapabilities),
    });
  }
  return result;
}

function parseQuickActions(value: unknown): readonly ModuleQuickActionDescriptor[] {
  if (!Array.isArray(value)) return [];
  const result: ModuleQuickActionDescriptor[] = [];
  for (const candidate of value.slice(0, 12)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    const id = safeToken(item.id, '');
    const href = safePath(item.href);
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!id || !href || !label || label.length > 60) continue;
    result.push({
      id,
      label,
      href,
      requiredCapabilities: stringList(item.requiredCapabilities),
    });
  }
  return result;
}

export function parseProductModuleShellDescriptor(
  input: ProductModuleShellInput,
): ModuleShellDescriptor | null {
  const route = safePath(input.manifest.route);
  if (!route) return null;
  const shellValue = input.manifest.shell;
  const shell = shellValue && typeof shellValue === 'object' && !Array.isArray(shellValue)
    ? shellValue as Record<string, unknown>
    : {};

  return {
    key: safeToken(input.moduleKey, input.moduleKey),
    name: input.displayName,
    description: input.description,
    category: typeof shell.category === 'string' && shell.category.trim()
      ? shell.category.trim()
      : 'Apps',
    iconKey: safeToken(shell.iconKey, 'app'),
    baseRoute: route,
    defaultPinned: shell.defaultPinned === true,
    order: typeof shell.order === 'number' && Number.isFinite(shell.order) ? shell.order : 1000,
    sections: parseSections(shell.sections),
    quickActions: parseQuickActions(shell.quickActions),
  };
}
