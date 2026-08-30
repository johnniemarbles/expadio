export interface DraftCaseSchemaFieldState {
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly required: boolean;
  readonly options: readonly string[];
}

export interface DraftCaseSchemaEditorState {
  readonly version: number;
  readonly fields: readonly DraftCaseSchemaFieldState[];
}

export interface DraftCaseSchemaFieldErrors {
  readonly key?: string;
  readonly label?: string;
  readonly type?: string;
  readonly options?: string;
}

export interface DraftCaseSchemaEditorErrors {
  readonly version?: string;
  readonly fields?: Readonly<Record<number, DraftCaseSchemaFieldErrors>>;
}

export interface DraftCaseSchemaDefinitionShape {
  readonly caseSchema?: {
    readonly version: number;
    readonly fields: readonly {
      readonly key: string;
      readonly label: string;
      readonly type: string;
      readonly required?: boolean;
      readonly options?: readonly string[];
    }[];
  };
}

const CASE_FIELD_KEY = /^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/;
const CASE_FIELD_TYPES = new Set(['text', 'number', 'select']);

export function validateDraftCaseSchemaEditorState(
  state: DraftCaseSchemaEditorState,
): DraftCaseSchemaEditorErrors {
  const errors: {
    version?: string;
    fields?: Record<number, DraftCaseSchemaFieldErrors>;
  } = {};

  if (!Number.isInteger(state.version) || state.version <= 0) {
    errors.version = 'Schema version must be a positive integer.';
  }

  const seenKeys = new Set<string>();
  const fieldErrors: Record<number, DraftCaseSchemaFieldErrors> = {};

  state.fields.forEach((field, index) => {
    const current: {
      key?: string;
      label?: string;
      type?: string;
      options?: string;
    } = {};

    const key = field.key.trim();
    if (!CASE_FIELD_KEY.test(key)) {
      current.key = 'Use a stable field key starting with a letter.';
    } else if (seenKeys.has(key)) {
      current.key = 'Field keys must be unique.';
    } else {
      seenKeys.add(key);
    }

    if (field.label.trim() === '') current.label = 'Field label is required.';

    if (!CASE_FIELD_TYPES.has(field.type)) {
      current.type = 'Choose text, number, or select.';
    }

    const normalizedOptions = field.options.map((option) => option.trim());
    if (field.type === 'select') {
      if (
        normalizedOptions.length === 0
        || normalizedOptions.some((option) => option === '')
      ) {
        current.options = 'Select fields require at least one non-empty option.';
      }
    } else if (field.options.length > 0) {
      current.options = 'Only select fields may declare options.';
    }

    if (Object.keys(current).length > 0) fieldErrors[index] = current;
  });

  if (Object.keys(fieldErrors).length > 0) errors.fields = fieldErrors;
  return errors;
}

export function hasDraftCaseSchemaEditorErrors(
  errors: DraftCaseSchemaEditorErrors,
): boolean {
  return Boolean(errors.version || errors.fields);
}

export function caseSchemaFieldKeys(
  state: DraftCaseSchemaEditorState,
): readonly string[] {
  return state.fields.map((field) => field.key.trim()).filter(Boolean);
}

/** Preserve every non-schema Pack section while replacing only the case schema. */
export function applyDraftCaseSchemaEditorState<T extends DraftCaseSchemaDefinitionShape>(
  definition: T,
  state: DraftCaseSchemaEditorState,
): T {
  return {
    ...definition,
    caseSchema: {
      version: state.version,
      fields: state.fields.map((field) => ({
        key: field.key.trim(),
        label: field.label.trim(),
        type: field.type,
        ...(field.required ? { required: true } : {}),
        ...(field.type === 'select'
          ? { options: field.options.map((option) => option.trim()) }
          : {}),
      })),
    },
  } as T;
}

export function draftCaseSchemaStateFromDefinition(
  definition: DraftCaseSchemaDefinitionShape,
): DraftCaseSchemaEditorState {
  return {
    version: definition.caseSchema?.version ?? 1,
    fields: (definition.caseSchema?.fields ?? []).map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required === true,
      options: [...(field.options ?? [])],
    })),
  };
}
