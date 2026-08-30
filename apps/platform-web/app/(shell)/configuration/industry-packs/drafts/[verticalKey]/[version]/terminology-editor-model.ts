import {
  validatePresentationTerminology,
  type PresentationTerminologyCatalogue,
  type TerminologyValidationIssue,
} from '@expadio/business-config';

export interface DraftTerminologyLabelState {
  readonly locale: string;
  readonly singular: string;
  readonly plural: string;
}

export interface DraftTerminologyConceptState {
  readonly conceptKey: string;
  readonly labels: readonly DraftTerminologyLabelState[];
  readonly aliases: readonly string[];
}

export interface DraftTerminologyEditorState {
  readonly concepts: readonly DraftTerminologyConceptState[];
}

export interface DraftTerminologyEditorErrors {
  readonly issues: readonly TerminologyValidationIssue[];
}

export interface DraftTerminologyDefinitionShape {
  readonly terminology: {
    readonly defaultLocale: string;
    readonly concepts: readonly {
      readonly conceptKey: string;
      readonly labels: readonly {
        readonly locale: string;
        readonly singular: string;
        readonly plural: string;
      }[];
      readonly aliases?: readonly string[];
    }[];
  };
}

export function validateDraftTerminologyEditorState(
  state: DraftTerminologyEditorState,
  defaultLocale: string,
): DraftTerminologyEditorErrors {
  const catalogue: PresentationTerminologyCatalogue = {
    defaultLocale,
    concepts: state.concepts.map((concept) => ({
      conceptKey: concept.conceptKey,
      labels: concept.labels,
      ...(concept.aliases.length === 0 ? {} : { aliases: concept.aliases }),
    })),
  };
  const result = validatePresentationTerminology(catalogue);
  return result.valid ? { issues: [] } : { issues: result.issues };
}

export function hasDraftTerminologyEditorErrors(
  errors: DraftTerminologyEditorErrors,
): boolean {
  return errors.issues.length > 0;
}

/** Preserve canonical concept identity and every non-terminology Pack section. */
export function applyDraftTerminologyEditorState<T extends DraftTerminologyDefinitionShape>(
  definition: T,
  state: DraftTerminologyEditorState,
): T {
  return {
    ...definition,
    terminology: {
      ...definition.terminology,
      concepts: state.concepts.map((concept) => ({
        conceptKey: concept.conceptKey,
        labels: concept.labels.map((label) => ({
          locale: label.locale.trim(),
          singular: label.singular.trim(),
          plural: label.plural.trim(),
        })),
        ...(concept.aliases.length === 0
          ? {}
          : {
              aliases: [...new Set(
                concept.aliases
                  .map((alias) => alias.trim())
                  .filter(Boolean),
              )],
            }),
      })),
    },
  } as T;
}

export function draftTerminologyStateFromDefinition(
  definition: DraftTerminologyDefinitionShape,
): DraftTerminologyEditorState {
  return {
    concepts: definition.terminology.concepts.map((concept) => ({
      conceptKey: concept.conceptKey,
      labels: concept.labels.map((label) => ({ ...label })),
      aliases: [...(concept.aliases ?? [])],
    })),
  };
}

export function terminologyIssueForPath(
  errors: DraftTerminologyEditorErrors,
  path: string,
): TerminologyValidationIssue | undefined {
  return errors.issues.find((issue) => issue.path === path);
}
