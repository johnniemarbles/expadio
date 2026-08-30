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
