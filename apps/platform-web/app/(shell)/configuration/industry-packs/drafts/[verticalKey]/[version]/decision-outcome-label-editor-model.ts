export interface DraftDecisionOutcomeLabelState {
  readonly outcomeKey: string;
  readonly label: string;
}

export interface DraftDecisionOutcomeLabelsEditorState {
  readonly labels: readonly DraftDecisionOutcomeLabelState[];
}

export interface DraftDecisionOutcomeLabelFieldErrors {
  readonly outcomeKey?: string;
  readonly label?: string;
}

export interface DraftDecisionOutcomeLabelsEditorErrors {
  readonly labels?: Readonly<Record<number, DraftDecisionOutcomeLabelFieldErrors>>;
}

export interface DraftDecisionOutcomeLabelsDefinitionShape {
  readonly caseWorkflow?: {
    readonly decisionOutcomeLabels?: Readonly<Record<string, string>>;
  };
}

export function validateDraftDecisionOutcomeLabelsEditorState(
  state: DraftDecisionOutcomeLabelsEditorState,
): DraftDecisionOutcomeLabelsEditorErrors {
  const errors: Record<number, DraftDecisionOutcomeLabelFieldErrors> = {};
  const seen = new Set<string>();

  state.labels.forEach((entry, index) => {
    const fieldErrors: { outcomeKey?: string; label?: string } = {};
    const outcomeKey = entry.outcomeKey.trim();

    if (outcomeKey === '') {
      fieldErrors.outcomeKey = 'Decision outcome key is required.';
    } else if (entry.outcomeKey !== outcomeKey) {
      fieldErrors.outcomeKey = 'Decision outcome key must not have leading or trailing whitespace.';
    } else if (seen.has(outcomeKey)) {
      fieldErrors.outcomeKey = 'Decision outcome keys must be unique.';
    } else {
      seen.add(outcomeKey);
    }

    if (entry.label.trim() === '') {
      fieldErrors.label = 'Decision outcome label is required.';
    } else if (entry.label !== entry.label.trim()) {
      fieldErrors.label = 'Decision outcome label must not have leading or trailing whitespace.';
    }

    if (Object.keys(fieldErrors).length > 0) errors[index] = fieldErrors;
  });

  return Object.keys(errors).length === 0 ? {} : { labels: errors };
}

export function hasDraftDecisionOutcomeLabelErrors(
  errors: DraftDecisionOutcomeLabelsEditorErrors,
): boolean {
  return errors.labels !== undefined && Object.keys(errors.labels).length > 0;
}

/**
 * Replaces only the optional decision-outcome label map while preserving every
 * other case-workflow field. Clearing all rows removes the override entirely.
 */
export function applyDraftDecisionOutcomeLabelsEditorState<
  T extends DraftDecisionOutcomeLabelsDefinitionShape,
>(
  definition: T,
  state: DraftDecisionOutcomeLabelsEditorState,
): T {
  const decisionOutcomeLabels = Object.fromEntries(
    state.labels.map((entry) => [entry.outcomeKey.trim(), entry.label.trim()] as const),
  );
  const existingWorkflow = definition.caseWorkflow;

  if (existingWorkflow === undefined) {
    if (Object.keys(decisionOutcomeLabels).length === 0) return definition;
    return {
      ...definition,
      caseWorkflow: { decisionOutcomeLabels },
    } as T;
  }

  const { decisionOutcomeLabels: _previous, ...workflow } = existingWorkflow;
  return {
    ...definition,
    caseWorkflow: {
      ...workflow,
      ...(Object.keys(decisionOutcomeLabels).length === 0 ? {} : { decisionOutcomeLabels }),
    },
  } as T;
}

export function draftDecisionOutcomeLabelsStateFromDefinition(
  definition: DraftDecisionOutcomeLabelsDefinitionShape,
): DraftDecisionOutcomeLabelsEditorState {
  const labels = Object.entries(definition.caseWorkflow?.decisionOutcomeLabels ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([outcomeKey, label]) => ({ outcomeKey, label }));

  return { labels };
}
