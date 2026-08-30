export interface DraftWorkflowEditorStage {
  readonly key: string;
  label: string;
  guidance: string;
}

export interface DraftWorkflowEditorState {
  label: string;
  defaultLocale: string;
  workType: string;
  stages: DraftWorkflowEditorStage[];
}

export interface DraftWorkflowEditorErrors {
  readonly label?: string;
  readonly defaultLocale?: string;
  readonly workType?: string;
  readonly stages?: Readonly<Record<string, { readonly label?: string }>>;
}

export interface DraftWorkflowDefinitionShape {
  readonly label: string;
  readonly terminology: {
    readonly defaultLocale: string;
    readonly concepts: readonly unknown[];
    readonly [key: string]: unknown;
  };
  readonly caseWorkflow?: {
    readonly workType: string;
    readonly stages: Readonly<Record<string, string>>;
    readonly stageGuidance?: Readonly<Record<string, string>>;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

export function validateDraftWorkflowEditorState(
  input: DraftWorkflowEditorState,
): DraftWorkflowEditorErrors {
  const errors: {
    label?: string;
    defaultLocale?: string;
    workType?: string;
    stages?: Record<string, { label?: string }>;
  } = {};

  if (input.label.trim() === '') errors.label = 'Pack label is required.';
  if (input.defaultLocale.trim() === '') errors.defaultLocale = 'Default locale is required.';
  if (input.workType.trim() === '') errors.workType = 'Workflow name is required.';

  const stageErrors: Record<string, { label?: string }> = {};
  for (const stage of input.stages) {
    if (stage.label.trim() === '') stageErrors[stage.key] = { label: 'Stage label is required.' };
  }
  if (Object.keys(stageErrors).length > 0) errors.stages = stageErrors;
  return errors;
}

export function hasDraftWorkflowEditorErrors(errors: DraftWorkflowEditorErrors): boolean {
  return Boolean(errors.label || errors.defaultLocale || errors.workType || errors.stages);
}

/**
 * Applies only the fields exposed by the current editor while preserving every
 * other Industry Pack section verbatim. The server remains the authority that
 * validates the complete definition before persisting the optimistic update.
 */
export function applyDraftWorkflowEditorState<T extends DraftWorkflowDefinitionShape>(
  definition: T,
  state: DraftWorkflowEditorState,
): T {
  const stages = Object.fromEntries(
    state.stages.map((stage) => [stage.key, stage.label.trim()]),
  );
  const stageGuidance = Object.fromEntries(
    state.stages
      .filter((stage) => stage.guidance.trim() !== '')
      .map((stage) => [stage.key, stage.guidance.trim()]),
  );
  const workflow = definition.caseWorkflow ?? {
    workType: 'Case',
    stages: {},
  };

  return {
    ...definition,
    label: state.label.trim(),
    terminology: {
      ...definition.terminology,
      defaultLocale: state.defaultLocale.trim(),
    },
    caseWorkflow: {
      ...workflow,
      workType: state.workType.trim(),
      stages,
      stageGuidance,
    },
  } as T;
}
