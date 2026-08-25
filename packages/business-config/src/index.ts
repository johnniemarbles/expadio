export type SemanticKey = string & { readonly __semanticKey: unique symbol };

const SEMANTIC_KEY_PATTERN = /^[A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)*$/;

/** Stable machine identifier. Editable labels must never be used as this key. */
export function semanticKey(value: string): SemanticKey {
  const normalized = value.trim();
  if (!SEMANTIC_KEY_PATTERN.test(normalized)) {
    throw new Error('BUSINESS_CONFIG_SEMANTIC_KEY_INVALID');
  }
  return normalized as SemanticKey;
}

export type TerminologyPackScope =
  | { readonly type: 'PLATFORM' }
  | { readonly type: 'INDUSTRY'; readonly industryKey: string }
  | { readonly type: 'TENANT'; readonly tenantId: string }
  | {
      readonly type: 'ORGANIZATION';
      readonly tenantId: string;
      readonly organizationId: string;
    };

export interface TerminologyEntry {
  readonly semanticKey: SemanticKey;
  readonly singular: string;
  readonly plural: string;
  readonly shortLabel?: string;
  readonly description?: string;
}

export interface TerminologyPack {
  readonly packKey: string;
  readonly version: number;
  readonly locale: string;
  readonly scope: TerminologyPackScope;
  readonly entries: readonly TerminologyEntry[];
  readonly effectiveFrom?: string;
  readonly effectiveUntil?: string;
}

export interface TerminologyPackValidationIssue {
  readonly code:
    | 'TERMINOLOGY_PACK_KEY_REQUIRED'
    | 'TERMINOLOGY_PACK_VERSION_INVALID'
    | 'TERMINOLOGY_PACK_LOCALE_REQUIRED'
    | 'TERMINOLOGY_LABEL_REQUIRED'
    | 'TERMINOLOGY_SEMANTIC_KEY_DUPLICATE'
    | 'TERMINOLOGY_EFFECTIVE_RANGE_INVALID';
  readonly field: string;
  readonly message: string;
}

export interface TerminologyPackValidationResult {
  readonly valid: boolean;
  readonly issues: readonly TerminologyPackValidationIssue[];
}

export function validateTerminologyPack(pack: TerminologyPack): TerminologyPackValidationResult {
  const issues: TerminologyPackValidationIssue[] = [];

  if (pack.packKey.trim() === '') {
    issues.push(issue('TERMINOLOGY_PACK_KEY_REQUIRED', 'packKey', 'packKey is required.'));
  }
  if (!Number.isInteger(pack.version) || pack.version < 1) {
    issues.push(issue('TERMINOLOGY_PACK_VERSION_INVALID', 'version', 'version must be a positive integer.'));
  }
  if (pack.locale.trim() === '') {
    issues.push(issue('TERMINOLOGY_PACK_LOCALE_REQUIRED', 'locale', 'locale is required.'));
  }

  const keys = new Set<string>();
  for (const [index, entry] of pack.entries.entries()) {
    if (entry.singular.trim() === '' || entry.plural.trim() === '') {
      issues.push(issue(
        'TERMINOLOGY_LABEL_REQUIRED',
        `entries[${index}]`,
        'singular and plural terminology labels are required.',
      ));
    }
    if (keys.has(entry.semanticKey)) {
      issues.push(issue(
        'TERMINOLOGY_SEMANTIC_KEY_DUPLICATE',
        `entries[${index}].semanticKey`,
        `Semantic key ${entry.semanticKey} occurs more than once in the same terminology pack.`,
      ));
    }
    keys.add(entry.semanticKey);
  }

  if (pack.effectiveFrom !== undefined && pack.effectiveUntil !== undefined) {
    const from = Date.parse(pack.effectiveFrom);
    const until = Date.parse(pack.effectiveUntil);
    if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) {
      issues.push(issue(
        'TERMINOLOGY_EFFECTIVE_RANGE_INVALID',
        'effectiveUntil',
        'effectiveUntil must be later than effectiveFrom.',
      ));
    }
  }

  return { valid: issues.length === 0, issues };
}

function issue(
  code: TerminologyPackValidationIssue['code'],
  field: string,
  message: string,
): TerminologyPackValidationIssue {
  return { code, field, message };
}
